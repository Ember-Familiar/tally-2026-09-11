import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { createDatabase } from '../src/db';
import * as indexExports from '../src/index';
import {
  calculateRatioSplits,
  BalanceEngineError,
} from '../src/balances';
import { parseId } from '../src/routes/groups';

describe('Task 10: Cross-endpoint validation and consistent error responses', () => {
  describe('Error plumbing & status responses', () => {
    it('catches unexpected errors via centralized error middleware and returns 500 JSON without stack trace while logging diagnostics server-side', async () => {
      const db = createDatabase(':memory:');
      const app = createApp(db);

      // Spy on console.error to verify server-side diagnostics logging
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Force an unexpected internal error during route execution by closing db before request
      db.close();

      const res = await request(app).get('/groups');
      expect(res.status).toBe(500);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Internal server error' });
      expect(res.text).not.toContain('/home/');
      expect(res.text).not.toContain('stack');
      expect(res.text).not.toContain('better-sqlite3');

      // Verify diagnostics logged to server console
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('Unhandled internal server error:', expect.anything());

      errorSpy.mockRestore();
    });

    it('returns 413 Payload Too Large as JSON without leaking filesystem paths', async () => {
      const app = createApp(createDatabase(':memory:'));
      const largePayload = { data: 'x'.repeat(150 * 1024) };
      const res = await request(app).post('/groups').send(largePayload);
      expect(res.status).toBe(413);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Payload too large' });
      expect(res.text).not.toContain('/home/');
      expect(res.text).not.toContain('node_modules');
      expect(res.text).not.toContain('body-parser');
    });

    it('returns 400 Invalid JSON payload on malformed request bodies', async () => {
      const app = createApp(createDatabase(':memory:'));
      const res = await request(app)
        .post('/groups')
        .set('Content-Type', 'application/json')
        .send('{ malformed: ');
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Invalid JSON payload' });
    });

    it('returns 415 Unsupported media type for unsupported content encoding', async () => {
      const app = createApp(createDatabase(':memory:'));
      const res = await request(app)
        .post('/groups')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'br-nope')
        .send('test');
      expect(res.status).toBe(415);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Unsupported media type' });
      expect(res.text).not.toContain('br-nope');
      expect(res.text).not.toContain('stack');
    });

    it('returns 400 Bad request for decompression / encoding header check failure', async () => {
      const app = createApp(createDatabase(':memory:'));
      const res = await request(app)
        .post('/groups')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send('test');
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Bad request' });
      expect(res.text).not.toContain('incorrect header check');
      expect(res.text).not.toContain('stack');
    });
  });

  describe('Routing & 404 normalization consistency', () => {
    it('returns typed 404 JSON for normalized path traversals (/groups/../expenses)', async () => {
      const app = createApp(createDatabase(':memory:'));
      const res = await request(app).get('/groups/../expenses');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    it('returns typed 404 JSON for unknown root routes', async () => {
      const app = createApp(createDatabase(':memory:'));
      const res = await request(app).get('/completely-unknown-path');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Not found' });
    });
  });

  describe('ID canonicalization (parseId and URL params)', () => {
    it('parseId rejects leading zeros and non-canonical numeric strings', () => {
      expect(parseId('1')).toBe(1);
      expect(parseId('42')).toBe(42);
      expect(parseId(1)).toBe(1);
      expect(parseId('01')).toBeNull();
      expect(parseId('001')).toBeNull();
      expect(parseId('007')).toBeNull();
      expect(parseId('0')).toBeNull();
      expect(parseId(-5)).toBeNull();
    });

    it('rejects /groups/01 with 400 while /groups/1 resolves', async () => {
      const app = createApp(createDatabase(':memory:'));
      const createRes = await request(app)
        .post('/groups')
        .send({ name: 'Canonical Group', members: ['Alice'] });
      expect(createRes.status).toBe(201);
      const groupId = createRes.body.id;
      expect(groupId).toBe(1);

      // Non-canonical ID with leading zero returns 400
      const res01 = await request(app).get('/groups/01');
      expect(res01.status).toBe(400);
      expect(res01.body).toEqual({ error: 'Invalid group ID: must be a positive integer' });

      // Canonical ID resolves 200
      const res1 = await request(app).get(`/groups/${groupId}`);
      expect(res1.status).toBe(200);
      expect(res1.body.name).toBe('Canonical Group');

      // Subresource non-canonical ID also rejected with 400
      const expenses01 = await request(app).get('/groups/01/expenses');
      expect(expenses01.status).toBe(400);
      expect(expenses01.body).toEqual({ error: 'Invalid group ID: must be a positive integer' });

      const balances01 = await request(app).get('/groups/01/balances');
      expect(balances01.status).toBe(400);
      expect(balances01.body).toEqual({ error: 'Invalid group ID: must be a positive integer' });

      const settlements01 = await request(app).get('/groups/01/settlements');
      expect(settlements01.status).toBe(400);
      expect(settlements01.body).toEqual({ error: 'Invalid group ID: must be a positive integer' });
    });
  });

  describe('Participant resolution scoped to group', () => {
    it('scopes payer-by-name lookup to target group, correctly resolving NOCASE duplicate names across groups', async () => {
      const db = createDatabase(':memory:');
      const app = createApp(db);

      // Group 1 has Bob (user 1)
      const g1 = await request(app).post('/groups').send({ name: 'Group 1', members: ['Bob'] });
      const g1Id = g1.body.id;

      // Group 2 has Alice (user 2)
      await request(app).post('/groups').send({ name: 'Group 2', members: ['Alice'] });

      // Another user named Alice (user 3) is added to Group 1
      db.prepare("INSERT INTO users (name) VALUES ('Alice')").run(); // user 3
      db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)").run(g1Id, 3);

      // Post expense in Group 1 with paid_by: "Alice" (or "alice")
      const resStr = await request(app)
        .post(`/groups/${g1Id}/expenses`)
        .send({ amount: 1000, description: 'Lunch', paid_by: 'alice' });

      expect(resStr.status).toBe(201);
      expect(resStr.body.paid_by).toBe(3);

      // Object form { name: "Alice" }
      const resObj = await request(app)
        .post(`/groups/${g1Id}/expenses`)
        .send({ amount: 1000, description: 'Coffee', paid_by: { name: 'ALICE' } });

      expect(resObj.status).toBe(201);
      expect(resObj.body.paid_by).toBe(3);
    });

    it('rejects payer name when name does not exist within the group', async () => {
      const app = createApp(createDatabase(':memory:'));
      const g = await request(app).post('/groups').send({ name: 'Solo Group', members: ['Alice'] });
      const res = await request(app)
        .post(`/groups/${g.body.id}/expenses`)
        .send({ amount: 1000, description: 'Dinner', paid_by: 'NonMember' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Payer must be a member of the group' });
    });
  });

  describe('Alias precedence and third payer alias', () => {
    it('pins expense payer alias precedence: paid_by > payer_id > payer', async () => {
      const app = createApp(createDatabase(':memory:'));
      const g = await request(app)
        .post('/groups')
        .send({ name: 'Alias Test', members: ['Alice', 'Bob', 'Charlie'] });
      const gId = g.body.id;

      // paid_by vs payer_id vs payer: paid_by (Alice = 1) wins over payer_id (Bob = 2) and payer (Charlie = 3)
      const res1 = await request(app).post(`/groups/${gId}/expenses`).send({
        amount: 3000,
        description: 'Test 1',
        paid_by: 1,
        payer_id: 2,
        payer: 3,
      });
      expect(res1.status).toBe(201);
      expect(res1.body.paid_by).toBe(1);

      // payer_id vs payer: payer_id (Bob = 2) wins over payer (Charlie = 3)
      const res2 = await request(app).post(`/groups/${gId}/expenses`).send({
        amount: 3000,
        description: 'Test 2',
        payer_id: 2,
        payer: 3,
      });
      expect(res2.status).toBe(201);
      expect(res2.body.paid_by).toBe(2);

      // payer alone (Charlie = 3) works
      const res3 = await request(app).post(`/groups/${gId}/expenses`).send({
        amount: 3000,
        description: 'Test 3',
        payer: 3,
      });
      expect(res3.status).toBe(201);
      expect(res3.body.paid_by).toBe(3);
    });

    it('pins settlement alias precedence for from and to', async () => {
      const app = createApp(createDatabase(':memory:'));
      const g = await request(app)
        .post('/groups')
        .send({ name: 'Settle Aliases', members: ['Alice', 'Bob', 'Charlie'] });
      const gId = g.body.id;

      // from precedence: from > from_user_id > paid_by > payer_id > payer
      // to precedence: to > to_user_id > paid_to > payee_id > payee > received_by
      const res = await request(app).post(`/groups/${gId}/settle`).send({
        amount: 1000,
        from: 1, // Alice
        from_user_id: 2, // Bob
        paid_by: 3, // Charlie
        to: 2, // Bob
        to_user_id: 3, // Charlie
        paid_to: 1, // Alice
      });
      expect(res.status).toBe(201);
      expect(res.body.from_user_id).toBe(1);
      expect(res.body.to_user_id).toBe(2);
    });

    it('pins split participant alias precedence: user_id > userId > user > member_id > member > id > name', async () => {
      const app = createApp(createDatabase(':memory:'));
      const g = await request(app)
        .post('/groups')
        .send({ name: 'Split Aliases', members: ['Alice', 'Bob', 'Charlie'] });
      const gId = g.body.id;

      // In split item, user_id (1) wins over userId (2) and member (3)
      const res = await request(app).post(`/groups/${gId}/expenses`).send({
        amount: 3000,
        paid_by: 1,
        description: 'Multi-alias split',
        splits: [
          { user_id: 1, userId: 2, member: 3, amount: 2000 },
          { user_id: 2, amount: 1000 },
        ],
      });
      expect(res.status).toBe(201);
      expect(res.body.splits[0].user_id).toBe(1);
    });
  });

  describe('Split validation consistency: object-form and null handling', () => {
    it('rejects object-form splits with split_type: equal with 400 (matching array-form behavior)', async () => {
      const app = createApp(createDatabase(':memory:'));
      const g = await request(app)
        .post('/groups')
        .send({ name: 'Equal Contradiction', members: ['Alice', 'Bob'] });
      const gId = g.body.id;

      // Object form contradictory specification
      const resObj = await request(app).post(`/groups/${gId}/expenses`).send({
        amount: 1000,
        paid_by: 1,
        description: 'Contradiction Object',
        splits: { '1': 600, '2': 400 },
        split_type: 'equal',
      });
      expect(resObj.status).toBe(400);
      expect(resObj.body).toEqual({
        error: 'Invalid split specification: unexpected split values for equal split',
      });

      // Array form contradictory specification
      const resArr = await request(app).post(`/groups/${gId}/expenses`).send({
        amount: 1000,
        paid_by: 1,
        description: 'Contradiction Array',
        splits: [
          { user_id: 1, amount: 600 },
          { user_id: 2, amount: 400 },
        ],
        split_type: 'equal',
      });
      expect(resArr.status).toBe(400);
      expect(resArr.body).toEqual({
        error: 'Invalid split specification: unexpected split values for equal split',
      });
    });

    it('rejects split_type: null with 400 Bad Request uniformly', async () => {
      const app = createApp(createDatabase(':memory:'));
      const g = await request(app).post('/groups').send({ name: 'Null Test', members: ['Alice', 'Bob'] });
      const gId = g.body.id;

      const res = await request(app).post(`/groups/${gId}/expenses`).send({
        amount: 1000,
        paid_by: 1,
        description: 'Null split_type',
        split_type: null,
      });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'split_type must be a string' });
    });

    it('rejects null for splits, shares, ratios, percentages, and split_amounts with 400', async () => {
      const app = createApp(createDatabase(':memory:'));
      const g = await request(app).post('/groups').send({ name: 'Null Collections', members: ['Alice', 'Bob'] });
      const gId = g.body.id;

      for (const field of ['splits', 'shares', 'ratios', 'percentages', 'split_amounts']) {
        const res = await request(app).post(`/groups/${gId}/expenses`).send({
          amount: 1000,
          paid_by: 1,
          description: `Null ${field}`,
          [field]: null,
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Splits must be an array or object');
      }
    });
  });

  describe('Balance engine ratio zero-weight guard (coverage gap)', () => {
    it('pins calculateRatioSplits zero-weight guard when scaled weight rounds to 0n (ratio: 1e-7)', () => {
      // ratio: 1e-7 passes initial > 0 check, but has no decimal point in string representation ('1e-7'),
      // so maxDecimals remains 0 or small, scaled rounds to 0, and w <= 0n triggers
      expect(() => {
        calculateRatioSplits(1000, [
          { userId: 1, ratio: 1 },
          { userId: 2, ratio: 1e-7 },
        ]);
      }).toThrow(BalanceEngineError);

      expect(() => {
        calculateRatioSplits(1000, [
          { userId: 1, ratio: 1 },
          { userId: 2, ratio: 1e-7 },
        ]);
      }).toThrow('Split ratio must be a positive number');
    });

    it('rejects ratio: 1e-7 over HTTP with 400 Bad Request', async () => {
      const app = createApp(createDatabase(':memory:'));
      const g = await request(app).post('/groups').send({ name: 'Tiny Ratio', members: ['Alice', 'Bob'] });
      const gId = g.body.id;

      const res = await request(app).post(`/groups/${gId}/expenses`).send({
        amount: 1000,
        paid_by: 1,
        description: 'Tiny Ratio Test',
        ratios: { '1': 1, '2': 1e-7 },
      });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Split ratio must be a positive number' });
    });
  });

  describe('Settlements phantom balance protection & GET /groups/:id/settlements', () => {
    it('returns 500 on /balances and /settlements when settlement contains non-group participant', async () => {
      const db = createDatabase(':memory:');
      const app = createApp(db);

      const g = await request(app).post('/groups').send({ name: 'Phantom Balance Test', members: ['Alice', 'Bob'] });
      const gId = g.body.id;

      // Direct SQL insert of an outsider user
      db.prepare("INSERT INTO users (name) VALUES ('Intruder')").run(); // user 3
      // Direct SQL settlement referencing outsider
      db.prepare(
        'INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, description) VALUES (?, ?, ?, ?, ?)'
      ).run(gId, 1, 3, 500, 'Direct SQL settlement');

      // GET /balances detects corruption and returns 500 without leaking internal details
      const resBalances = await request(app).get(`/groups/${gId}/balances`);
      expect(resBalances.status).toBe(500);
      expect(resBalances.headers['content-type']).toMatch(/application\/json/);
      expect(resBalances.body).toEqual({ error: 'Internal server error' });
      expect(resBalances.text).not.toContain('Corrupt settlement');
      expect(resBalances.text).not.toContain('participant is not a member of group');

      // GET /settlements also enforces the membership invariant and returns 500 without leaking details
      const resSettlements = await request(app).get(`/groups/${gId}/settlements`);
      expect(resSettlements.status).toBe(500);
      expect(resSettlements.headers['content-type']).toMatch(/application\/json/);
      expect(resSettlements.body).toEqual({ error: 'Internal server error' });
      expect(resSettlements.text).not.toContain('Corrupt settlement');
      expect(resSettlements.text).not.toContain('participant is not a member of group');
    });

    it('GET /groups/:id/settlements returns chronological list and handles empty state and 404/400', async () => {
      const app = createApp(createDatabase(':memory:'));
      const g = await request(app).post('/groups').send({ name: 'Settlement List Group', members: ['Alice', 'Bob'] });
      const gId = g.body.id;

      // Empty state
      const emptyRes = await request(app).get(`/groups/${gId}/settlements`);
      expect(emptyRes.status).toBe(200);
      expect(emptyRes.body).toEqual([]);

      // Record settlements
      await request(app).post(`/groups/${gId}/settle`).send({
        amount: 1000,
        from: 2,
        to: 1,
        description: 'Payment 1',
        date: '2026-09-05 10:00:00',
      });
      await request(app).post(`/groups/${gId}/settle`).send({
        amount: 1500,
        from: 1,
        to: 2,
        description: 'Payment 2',
        date: '2026-09-05 12:00:00',
      });

      // List returns newest date first
      const listRes = await request(app).get(`/groups/${gId}/settlements`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(2);
      expect(listRes.body[0].description).toBe('Payment 2');
      expect(listRes.body[0].amount).toBe(1500);
      expect(listRes.body[1].description).toBe('Payment 1');
      expect(listRes.body[1].amount).toBe(1000);

      // Unknown group returns 404
      const res404 = await request(app).get('/groups/999999/settlements');
      expect(res404.status).toBe(404);
      expect(res404.body).toEqual({ error: 'Group not found' });

      // Malformed ID returns 400
      const res400 = await request(app).get('/groups/invalid-id/settlements');
      expect(res400.status).toBe(400);
      expect(res400.body).toEqual({ error: 'Invalid group ID: must be a positive integer' });
    });
  });

  describe('Export integrity of src/index.ts', () => {
    it('exports isValidDate, parseAmount, and parseDate from root package', () => {
      expect(typeof indexExports.isValidDate).toBe('function');
      expect(typeof indexExports.parseAmount).toBe('function');
      expect(typeof indexExports.parseDate).toBe('function');

      // Test helper logic directly through root export
      expect(indexExports.isValidDate('2026-09-05 20:00:00')).toBe(true);
      expect(indexExports.isValidDate('invalid-date')).toBe(false);

      expect(indexExports.parseAmount(5000)).toBe(5000);
      expect(() => indexExports.parseAmount(-100)).toThrow();

      expect(indexExports.parseDate('2026-09-05 20:00:00')).toBe('2026-09-05 20:00:00');
      expect(indexExports.parseDate(undefined)).toBeUndefined();
    });
  });
});
