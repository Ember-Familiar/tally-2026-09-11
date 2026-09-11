import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../src/app';
import { createDatabase } from '../src/db';

describe('Settlement Routes & Integration', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDatabase(':memory:');
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  // Helper to create a group with members
  async function createTestGroup(name: string, members: string[]) {
    const res = await request(app).post('/groups').send({ name, members });
    expect(res.status).toBe(201);
    return res.body as {
      id: number;
      name: string;
      members: { id: number; name: string }[];
    };
  }

  // Helper to post an expense
  async function postExpense(
    groupId: number,
    paidBy: number | string,
    amount: number,
    description = 'Expense'
  ) {
    const res = await request(app)
      .post(`/groups/${groupId}/expenses`)
      .send({ paid_by: paidBy, amount, description });
    expect(res.status).toBe(201);
    return res.body;
  }

  describe('POST /groups/:id/settle - Parameter & Body Validation', () => {
    it('returns 400 for malformed group ID', async () => {
      for (const badId of ['abc', '0', '-1', '1.5', ' 1 ']) {
        const res = await request(app)
          .post(`/groups/${badId}/settle`)
          .send({ from: 1, to: 2, amount: 1000 });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid group ID: must be a positive integer' });
      }
    });

    it('returns 404 for non-existent group', async () => {
      const res = await request(app)
        .post('/groups/99999/settle')
        .send({ from: 1, to: 2, amount: 1000 });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Group not found' });
    });

    it('validates amount strictly: requires positive safe integer cents', async () => {
      const group = await createTestGroup('Trip', ['Alice', 'Bob']);

      // Missing amount
      const res1 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 1, to: 2 });
      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: 'Amount is required' });

      // Zero amount
      const res2 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 1, to: 2, amount: 0 });
      expect(res2.status).toBe(400);
      expect(res2.body).toEqual({ error: 'Amount must be a positive integer in cents' });

      // Negative amount
      const res3 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 1, to: 2, amount: -500 });
      expect(res3.status).toBe(400);
      expect(res3.body).toEqual({ error: 'Amount must be a positive integer in cents' });

      // Floating-point cents
      const res4 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 1, to: 2, amount: 10.5 });
      expect(res4.status).toBe(400);
      expect(res4.body).toEqual({ error: 'Amount must be a positive integer in cents' });

      // String amount (not safe integer number)
      const res5 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 1, to: 2, amount: '1000' });
      expect(res5.status).toBe(400);
      expect(res5.body).toEqual({ error: 'Amount must be a positive integer in cents' });
    });

    it('requires payer (from)', async () => {
      const group = await createTestGroup('Trip', ['Alice', 'Bob']);

      const res = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ to: 2, amount: 1000 });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Payer is required' });
    });

    it('requires payee (to)', async () => {
      const group = await createTestGroup('Trip', ['Alice', 'Bob']);

      const res = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 1, amount: 1000 });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Payee is required' });
    });

    it('rejects self-settlement when from and to are the same user', async () => {
      const group = await createTestGroup('Trip', ['Alice', 'Bob']);

      // By ID
      const res1 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 1, to: 1, amount: 1000 });
      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: 'Cannot settle with self' });

      // By Name
      const res2 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 'Alice', to: 'Alice', amount: 1000 });
      expect(res2.status).toBe(400);
      expect(res2.body).toEqual({ error: 'Cannot settle with self' });

      // Mixed
      const res3 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 1, to: 'Alice', amount: 1000 });
      expect(res3.status).toBe(400);
      expect(res3.body).toEqual({ error: 'Cannot settle with self' });
    });

    it('rejects participants not in the group', async () => {
      const group1 = await createTestGroup('Group 1', ['Alice', 'Bob']);
      await createTestGroup('Group 2', ['Charlie', 'Dave']);

      // User exists but not in group1 (Charlie is id 3)
      const res1 = await request(app)
        .post(`/groups/${group1.id}/settle`)
        .send({ from: 3, to: 1, amount: 1000 });
      expect(res1.status).toBe(400);
      expect(res1.body).toEqual({ error: 'Payer must be a member of the group' });

      const res2 = await request(app)
        .post(`/groups/${group1.id}/settle`)
        .send({ from: 1, to: 3, amount: 1000 });
      expect(res2.status).toBe(400);
      expect(res2.body).toEqual({ error: 'Payee must be a member of the group' });

      // Non-existent user ID
      const res3 = await request(app)
        .post(`/groups/${group1.id}/settle`)
        .send({ from: 9999, to: 1, amount: 1000 });
      expect(res3.status).toBe(400);
      expect(res3.body).toEqual({ error: 'Payer must be a member of the group' });

      const res4 = await request(app)
        .post(`/groups/${group1.id}/settle`)
        .send({ from: 1, to: 9999, amount: 1000 });
      expect(res4.status).toBe(400);
      expect(res4.body).toEqual({ error: 'Payee must be a member of the group' });

      // Non-existent name
      const res5 = await request(app)
        .post(`/groups/${group1.id}/settle`)
        .send({ from: 'NonExistent', to: 'Alice', amount: 1000 });
      expect(res5.status).toBe(400);
      expect(res5.body).toEqual({ error: 'Payer must be a member of the group' });
    });

    it('validates date format strictly', async () => {
      const group = await createTestGroup('Trip', ['Alice', 'Bob']);

      for (const badDate of ['not-a-date', '2026-02-30 00:00:00', '2026-09-05T12:00:00Z', '2026-09-05', 'now']) {
        const res = await request(app)
          .post(`/groups/${group.id}/settle`)
          .send({ from: 1, to: 2, amount: 1000, date: badDate });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid date format: must be YYYY-MM-DD HH:MM:SS' });
      }
    });

    it('validates description type', async () => {
      const group = await createTestGroup('Trip', ['Alice', 'Bob']);

      const res = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 1, to: 2, amount: 1000, description: 12345 });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Description must be a string' });
    });
  });

  describe('POST /groups/:id/settle - Creation & Response Shape', () => {
    it('creates settlement with user IDs and returns 201 with full details', async () => {
      const group = await createTestGroup('Ski Trip', ['Alice', 'Bob']);
      const aliceId = group.members[0].id;
      const bobId = group.members[1].id;

      const res = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({
          from: bobId,
          to: aliceId,
          amount: 2500,
          description: 'Cabin fee repayment',
          date: '2026-09-05 20:00:00',
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: 1,
        group_id: group.id,
        from: bobId,
        to: aliceId,
        from_user_id: bobId,
        to_user_id: aliceId,
        from_name: 'Bob',
        to_name: 'Alice',
        amount: 2500,
        description: 'Cabin fee repayment',
        date: '2026-09-05 20:00:00',
        created_at: expect.any(String),
      });

      // Verify in SQLite database
      const row = db.prepare('SELECT * FROM settlements WHERE id = 1').get() as {
        id: number;
        group_id: number;
        from_user_id: number;
        to_user_id: number;
        amount: number;
        description: string;
        date: string;
      };
      expect(row.group_id).toBe(group.id);
      expect(row.from_user_id).toBe(bobId);
      expect(row.to_user_id).toBe(aliceId);
      expect(row.amount).toBe(2500);
      expect(row.description).toBe('Cabin fee repayment');
      expect(row.date).toBe('2026-09-05 20:00:00');
    });

    it('accepts participant names and aliases (paid_by / paid_to, payer_id / payee_id, etc.)', async () => {
      const group = await createTestGroup('Dinner Club', ['Alice', 'Bob']);
      const aliceId = group.members[0].id;
      const bobId = group.members[1].id;

      // By name
      const res1 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({
          from: 'Bob',
          to: 'Alice',
          amount: 1000,
        });
      expect(res1.status).toBe(201);
      expect(res1.body.from).toBe(bobId);
      expect(res1.body.to).toBe(aliceId);

      // By object
      const res2 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({
          from: { name: 'bob' }, // case-insensitive match
          to: { id: aliceId },
          amount: 1500,
        });
      expect(res2.status).toBe(201);
      expect(res2.body.from).toBe(bobId);
      expect(res2.body.to).toBe(aliceId);

      // By aliases: paid_by / paid_to
      const res3 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({
          paid_by: bobId,
          paid_to: aliceId,
          amount: 500,
        });
      expect(res3.status).toBe(201);
      expect(res3.body.from).toBe(bobId);
      expect(res3.body.to).toBe(aliceId);

      // By aliases: payer_id / payee_id
      const res4 = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({
          payer_id: bobId,
          payee_id: aliceId,
          amount: 500,
        });
      expect(res4.status).toBe(201);
      expect(res4.body.from).toBe(bobId);
      expect(res4.body.to).toBe(aliceId);
    });

    it('defaults date to CURRENT_TIMESTAMP when omitted', async () => {
      const group = await createTestGroup('Trip', ['Alice', 'Bob']);

      const res = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: 1, to: 2, amount: 1000 });

      expect(res.status).toBe(201);
      expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(res.body.description).toBe('');
    });
  });

  describe('GET /groups/:id/settlements (Listing)', () => {
    it('returns empty array when group has no settlements', async () => {
      const group = await createTestGroup('Trip', ['Alice', 'Bob']);

      const res = await request(app).get(`/groups/${group.id}/settlements`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);

      // Verify the dropped /settle GET alias returns 404
      const aliasRes = await request(app).get(`/groups/${group.id}/settle`);
      expect(aliasRes.status).toBe(404);
    });

    it('lists settlements in date DESC, id DESC order', async () => {
      const group = await createTestGroup('Trip', ['Alice', 'Bob']);
      const [alice, bob] = group.members;

      await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: bob.id, to: alice.id, amount: 1000, date: '2026-09-01 10:00:00' });
      await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: bob.id, to: alice.id, amount: 2000, date: '2026-09-03 10:00:00' });
      await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: alice.id, to: bob.id, amount: 500, date: '2026-09-02 10:00:00' });

      const res = await request(app).get(`/groups/${group.id}/settlements`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0].amount).toBe(2000); // Sep 3
      expect(res.body[1].amount).toBe(500);  // Sep 2
      expect(res.body[2].amount).toBe(1000); // Sep 1
    });

    it('returns 400 for malformed ID and 404 for missing group', async () => {
      const res1 = await request(app).get('/groups/abc/settlements');
      expect(res1.status).toBe(400);

      const res2 = await request(app).get('/groups/99999/settlements');
      expect(res2.status).toBe(404);
    });
  });

  describe('Direction Pinning & Balance Engine Flow Through', () => {
    it('pins the direction of settlement: paying creditor reduces debt to zero', async () => {
      // Scenario: Alice pays 6000 cents split 3 ways (Alice, Bob, Charlie).
      // Each owes 2000.
      // Net: Alice +4000, Bob -2000, Charlie -2000.
      // Pairwise: Bob -> Alice 2000, Charlie -> Alice 2000.
      const group = await createTestGroup('Dinner', ['Alice', 'Bob', 'Charlie']);
      const [alice, bob, charlie] = group.members;

      await postExpense(group.id, alice.id, 6000, 'Dinner');

      // Check baseline balances before settlement
      const before = await request(app).get(`/groups/${group.id}/balances`);
      expect(before.status).toBe(200);
      expect(before.body.net_balances).toEqual({
        [alice.id]: 4000,
        [bob.id]: -2000,
        [charlie.id]: -2000,
      });
      expect(before.body.pairwise).toEqual([
        { from: bob.id, to: alice.id, from_user_id: bob.id, to_user_id: alice.id, from_name: 'Bob', to_name: 'Alice', amount: 2000 },
        { from: charlie.id, to: alice.id, from_user_id: charlie.id, to_user_id: alice.id, from_name: 'Charlie', to_name: 'Alice', amount: 2000 },
      ]);
      expect(before.body.settlements).toEqual([
        { from: bob.id, to: alice.id, from_user_id: bob.id, to_user_id: alice.id, from_name: 'Bob', to_name: 'Alice', amount: 2000 },
        { from: charlie.id, to: alice.id, from_user_id: charlie.id, to_user_id: alice.id, from_name: 'Charlie', to_name: 'Alice', amount: 2000 },
      ]);

      // Bob settles his 2000 cent debt with Alice: Bob (from) -> Alice (to)
      const settleRes = await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: bob.id, to: alice.id, amount: 2000 });
      expect(settleRes.status).toBe(201);

      // Check balances after settlement
      const after = await request(app).get(`/groups/${group.id}/balances`);
      expect(after.status).toBe(200);

      // Bob is now fully settled (net: 0). Alice is only owed 2000 by Charlie.
      expect(after.body.net_balances).toEqual({
        [alice.id]: 2000,
        [bob.id]: 0,
        [charlie.id]: -2000,
      });

      expect(after.body.balances).toEqual([
        { user_id: alice.id, userId: alice.id, name: 'Alice', paid: 6000, owed: 4000, net_balance: 2000, balance: 2000 },
        { user_id: bob.id, userId: bob.id, name: 'Bob', paid: 2000, owed: 2000, net_balance: 0, balance: 0 },
        { user_id: charlie.id, userId: charlie.id, name: 'Charlie', paid: 0, owed: 2000, net_balance: -2000, balance: -2000 },
      ]);

      // Direction verification: Pairwise debts contains ONLY Charlie -> Alice 2000.
      // If direction were inverted (Bob paid backwards), Bob would owe 4000!
      expect(after.body.pairwise).toEqual([
        { from: charlie.id, to: alice.id, from_user_id: charlie.id, to_user_id: alice.id, from_name: 'Charlie', to_name: 'Alice', amount: 2000 },
      ]);

      // Simplified settlements contains ONLY Charlie -> Alice 2000
      expect(after.body.settlements).toEqual([
        { from: charlie.id, to: alice.id, from_user_id: charlie.id, to_user_id: alice.id, from_name: 'Charlie', to_name: 'Alice', amount: 2000 },
      ]);

      // Total spend should still be 6000 (settlements do NOT affect total_spend)
      expect(after.body.total_spend).toBe(6000);
    });

    it('handles partial settlements correctly', async () => {
      const group = await createTestGroup('Cab', ['Alice', 'Bob']);
      const [alice, bob] = group.members;

      // Alice pays 5000 cents. Bob owes 2500 cents.
      await postExpense(group.id, alice.id, 5000, 'Taxi');

      // Bob pays 1000 cents towards the 2500 debt.
      await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: bob.id, to: alice.id, amount: 1000 });

      const balRes = await request(app).get(`/groups/${group.id}/balances`);
      expect(balRes.status).toBe(200);

      // Remaining debt is 1500 cents
      expect(balRes.body.net_balances).toEqual({
        [alice.id]: 1500,
        [bob.id]: -1500,
      });

      expect(balRes.body.pairwise).toEqual([
        { from: bob.id, to: alice.id, from_user_id: bob.id, to_user_id: alice.id, from_name: 'Bob', to_name: 'Alice', amount: 1500 },
      ]);
    });

    it('handles overpayment by reversing debt direction', async () => {
      const group = await createTestGroup('Groceries', ['Alice', 'Bob']);
      const [alice, bob] = group.members;

      // Alice pays 2000 cents. Bob owes 1000 cents.
      await postExpense(group.id, alice.id, 2000, 'Food');

      // Bob overpays Alice by sending 3000 cents.
      await request(app)
        .post(`/groups/${group.id}/settle`)
        .send({ from: bob.id, to: alice.id, amount: 3000 });

      const balRes = await request(app).get(`/groups/${group.id}/balances`);
      expect(balRes.status).toBe(200);

      // Now Alice owes Bob 2000 cents!
      expect(balRes.body.net_balances).toEqual({
        [alice.id]: -2000,
        [bob.id]: 2000,
      });

      expect(balRes.body.pairwise).toEqual([
        { from: alice.id, to: bob.id, from_user_id: alice.id, to_user_id: bob.id, from_name: 'Alice', to_name: 'Bob', amount: 2000 },
      ]);
      expect(balRes.body.settlements).toEqual([
        { from: alice.id, to: bob.id, from_user_id: alice.id, to_user_id: bob.id, from_name: 'Alice', to_name: 'Bob', amount: 2000 },
      ]);
    });

    it('conserves zero-sum invariant strictly end-to-end through HTTP', async () => {
      const group = await createTestGroup('Festival', ['Alice', 'Bob', 'Charlie', 'Dave']);
      const [alice, bob, charlie, dave] = group.members;

      // Sequence of multiple expenses and settlements
      await postExpense(group.id, alice.id, 10000, 'Tickets');
      await postExpense(group.id, bob.id, 4000, 'Drinks');

      // Verify conservation before settlements
      let res = await request(app).get(`/groups/${group.id}/balances`);
      let sum = res.body.balances.reduce((acc: number, b: { net_balance: number }) => acc + b.net_balance, 0);
      expect(sum).toBe(0);

      // Settlement 1: Charlie pays Alice 2500
      await request(app).post(`/groups/${group.id}/settle`).send({ from: charlie.id, to: alice.id, amount: 2500 });
      res = await request(app).get(`/groups/${group.id}/balances`);
      sum = res.body.balances.reduce((acc: number, b: { net_balance: number }) => acc + b.net_balance, 0);
      expect(sum).toBe(0);

      // Settlement 2: Dave pays Bob 1500
      await request(app).post(`/groups/${group.id}/settle`).send({ from: dave.id, to: bob.id, amount: 1500 });
      res = await request(app).get(`/groups/${group.id}/balances`);
      sum = res.body.balances.reduce((acc: number, b: { net_balance: number }) => acc + b.net_balance, 0);
      expect(sum).toBe(0);

      // Settlement 3: Dave pays Alice 2000
      await request(app).post(`/groups/${group.id}/settle`).send({ from: dave.id, to: alice.id, amount: 2000 });
      res = await request(app).get(`/groups/${group.id}/balances`);
      sum = res.body.balances.reduce((acc: number, b: { net_balance: number }) => acc + b.net_balance, 0);
      expect(sum).toBe(0);

      // Sum of paid equals sum of owed
      const totalPaid = res.body.balances.reduce((acc: number, b: { paid: number }) => acc + b.paid, 0);
      const totalOwed = res.body.balances.reduce((acc: number, b: { owed: number }) => acc + b.owed, 0);
      expect(totalPaid).toBe(totalOwed);

      // Total spend should be exactly 10000 + 4000 = 14000
      expect(res.body.total_spend).toBe(14000);
    });

    it('isolates settlements between different groups', async () => {
      const g1 = await createTestGroup('Group 1', ['Alice', 'Bob']);
      const g2 = await createTestGroup('Group 2', ['Charlie', 'Dave']);

      await postExpense(g1.id, 1, 4000, 'G1 Expense');
      await postExpense(g2.id, 3, 6000, 'G2 Expense');

      // Settle in G1
      await request(app).post(`/groups/${g1.id}/settle`).send({ from: 2, to: 1, amount: 2000 });

      // G1 should reflect settlement
      const g1Bal = await request(app).get(`/groups/${g1.id}/balances`);
      expect(g1Bal.body.net_balances).toEqual({ '1': 0, '2': 0 });

      // G2 should NOT reflect G1 settlement
      const g2Bal = await request(app).get(`/groups/${g2.id}/balances`);
      expect(g2Bal.body.net_balances).toEqual({ '3': 3000, '4': -3000 });
      expect(g2Bal.body.pairwise).toEqual([
        { from: 4, to: 3, from_user_id: 4, to_user_id: 3, from_name: 'Dave', to_name: 'Charlie', amount: 3000 },
      ]);
    });

    it('maintains flat query count in GET /groups/:id/balances when many settlements exist', async () => {
      const group = await createTestGroup('Flat Query Test', ['Alice', 'Bob']);
      await postExpense(group.id, 1, 10000, 'Big expense');

      // Record 10 small settlements
      for (let i = 0; i < 10; i++) {
        await request(app).post(`/groups/${group.id}/settle`).send({ from: 2, to: 1, amount: 100 });
      }

      // Count queries during GET /groups/:id/balances
      let queryCount = 0;
      const stmtProto = Object.getPrototypeOf(db.prepare('SELECT 1')) as {
        all: (...args: unknown[]) => unknown;
        get: (...args: unknown[]) => unknown;
      };
      const originalAll = stmtProto.all;
      const originalGet = stmtProto.get;

      stmtProto.all = function (this: unknown, ...args: unknown[]) {
        queryCount++;
        return originalAll.apply(this, args);
      };
      stmtProto.get = function (this: unknown, ...args: unknown[]) {
        queryCount++;
        return originalGet.apply(this, args);
      };

      try {
        const res = await request(app).get(`/groups/${group.id}/balances`);
        expect(res.status).toBe(200);
        // Expect exactly 5 queries: group existence check, members select, expenses select, splits select, settlements select
        expect(queryCount).toBe(5);
      } finally {
        stmtProto.all = originalAll;
        stmtProto.get = originalGet;
      }
    });
  });
});
