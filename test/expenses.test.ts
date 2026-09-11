import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../src/app';
import { createDatabase } from '../src/db';
import {
  parseAmount,
  parseDate,
  parseDescription,
  isValidDate,
  calculateEqualSplits,
  ValidationError,
  Member,
  Expense,
  ExpenseSplit,
} from '../src/routes/groups';

describe('Expense Routes - POST /groups/:id/expenses', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDatabase(':memory:');
    app = createApp(db);
  });

  describe('Pure helper unit tests', () => {
    describe('calculateEqualSplits arithmetic & remainder distribution', () => {
      it('splits 1000 cents evenly across 3 members with exact remainder distribution', () => {
        const splits = calculateEqualSplits(1000, [1, 2, 3]);
        expect(splits).toEqual([
          { userId: 1, amount: 334 },
          { userId: 2, amount: 333 },
          { userId: 3, amount: 333 },
        ]);
        const sum = splits.reduce((acc, s) => acc + s.amount, 0);
        expect(sum).toBe(1000);
      });

      it('splits 1 cent across 3 members with exact remainder distribution (1, 0, 0)', () => {
        const splits = calculateEqualSplits(1, [1, 2, 3]);
        expect(splits).toEqual([
          { userId: 1, amount: 1 },
          { userId: 2, amount: 0 },
          { userId: 3, amount: 0 },
        ]);
        const sum = splits.reduce((acc, s) => acc + s.amount, 0);
        expect(sum).toBe(1);
      });

      it('splits 2 cents across 3 members with exact remainder distribution (1, 1, 0)', () => {
        const splits = calculateEqualSplits(2, [1, 2, 3]);
        expect(splits).toEqual([
          { userId: 1, amount: 1 },
          { userId: 2, amount: 1 },
          { userId: 3, amount: 0 },
        ]);
        const sum = splits.reduce((acc, s) => acc + s.amount, 0);
        expect(sum).toBe(2);
      });

      it('sorts member IDs deterministically so lowest user_id absorbs remainder', () => {
        // Passing IDs out of order [3, 1, 2] must yield sorted order [1, 2, 3] with user 1 absorbing extra cent
        const splits = calculateEqualSplits(1000, [3, 1, 2]);
        expect(splits).toEqual([
          { userId: 1, amount: 334 },
          { userId: 2, amount: 333 },
          { userId: 3, amount: 333 },
        ]);
      });

      it('handles single member cleanly', () => {
        const splits = calculateEqualSplits(500, [1]);
        expect(splits).toEqual([{ userId: 1, amount: 500 }]);
      });

      it('throws ValidationError if member list is empty', () => {
        expect(() => calculateEqualSplits(100, [])).toThrow(ValidationError);
      });
    });

    describe('isValidDate and parseDate', () => {
      it('accepts valid YYYY-MM-DD HH:MM:SS timestamps', () => {
        expect(isValidDate('2026-09-05 17:00:00')).toBe(true);
        expect(isValidDate('2024-02-29 12:00:00')).toBe(true); // leap year
        expect(isValidDate('2026-12-31 23:59:59')).toBe(true);
        expect(isValidDate('2026-01-01 00:00:00')).toBe(true);
      });

      it('rejects bare "now" and "NOW" which would trigger SQLITE_ERROR', () => {
        expect(isValidDate('now')).toBe(false);
        expect(isValidDate('NOW')).toBe(false);
        expect(() => parseDate('now')).toThrow(ValidationError);
        expect(() => parseDate('NOW')).toThrow(ValidationError);
      });

      it('rejects ISO 8601 strings with T or Z', () => {
        expect(isValidDate('2026-09-05T17:00:00Z')).toBe(false);
        expect(isValidDate('2026-09-05T17:00:00')).toBe(false);
      });

      it('rejects date-only strings', () => {
        expect(isValidDate('2026-09-05')).toBe(false);
      });

      it('rejects 24:00:00 midnight spelling', () => {
        expect(isValidDate('2026-09-05 24:00:00')).toBe(false);
      });

      it('rejects invalid calendar dates (Feb 30, non-leap Feb 29, month 13)', () => {
        expect(isValidDate('2026-02-30 00:00:00')).toBe(false);
        expect(isValidDate('2026-02-29 00:00:00')).toBe(false); // 2026 not leap
        expect(isValidDate('2026-13-01 00:00:00')).toBe(false);
        expect(isValidDate('2026-04-31 00:00:00')).toBe(false); // April has 30 days
      });

      it('rejects year 0000 or negative years', () => {
        expect(isValidDate('0000-01-01 00:00:00')).toBe(false);
      });

      it('parseDate handles undefined/null by returning undefined', () => {
        expect(parseDate(undefined)).toBeUndefined();
        expect(parseDate(null)).toBeUndefined();
      });

      it('parseDate rejects non-string types or empty strings', () => {
        expect(() => parseDate(123)).toThrow(ValidationError);
        expect(() => parseDate('')).toThrow(ValidationError);
        expect(() => parseDate('   ')).toThrow(ValidationError);
      });
    });

    describe('parseAmount', () => {
      it('accepts positive safe integers', () => {
        expect(parseAmount(1)).toBe(1);
        expect(parseAmount(1000)).toBe(1000);
        expect(parseAmount(500000)).toBe(500000);
      });

      it('rejects non-integer, non-positive, missing or non-numeric values', () => {
        expect(() => parseAmount(undefined)).toThrow(ValidationError);
        expect(() => parseAmount(null)).toThrow(ValidationError);
        expect(() => parseAmount(0)).toThrow(ValidationError);
        expect(() => parseAmount(-10)).toThrow(ValidationError);
        expect(() => parseAmount(10.5)).toThrow(ValidationError);
        expect(() => parseAmount('1000')).toThrow(ValidationError);
        expect(() => parseAmount(NaN)).toThrow(ValidationError);
        expect(() => parseAmount(Infinity)).toThrow(ValidationError);
        expect(() => parseAmount(Number.MAX_SAFE_INTEGER + 1000)).toThrow(ValidationError);
      });
    });

    describe('parseDescription', () => {
      it('returns empty string if omitted or null', () => {
        expect(parseDescription(undefined)).toBe('');
        expect(parseDescription(null)).toBe('');
      });

      it('trims and returns string', () => {
        expect(parseDescription('  Lunch  ')).toBe('Lunch');
      });

      it('rejects non-string types', () => {
        expect(() => parseDescription(123)).toThrow(ValidationError);
        expect(() => parseDescription({})).toThrow(ValidationError);
      });
    });
  });

  describe('Integration tests: POST /groups/:id/expenses', () => {
    let groupId: number;
    let aliceId: number;
    let bobId: number;
    let charlieId: number;

    beforeEach(async () => {
      const gRes = await request(app)
        .post('/groups')
        .send({
          name: 'Trip Group',
          members: ['Alice', 'Bob', 'Charlie'],
        });
      expect(gRes.status).toBe(201);
      groupId = gRes.body.id;
      aliceId = gRes.body.members[0].id;
      bobId = gRes.body.members[1].id;
      charlieId = gRes.body.members[2].id;
    });

    it('creates an expense with equal split and exact integer-cent amounts', async () => {
      const res = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 6000,
          description: 'Groceries',
          paid_by: aliceId,
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: 1,
        group_id: groupId,
        paid_by: aliceId,
        amount: 6000,
        description: 'Groceries',
        date: expect.any(String),
        created_at: expect.any(String),
        splits: [
          {
            id: 1,
            expense_id: 1,
            user_id: aliceId,
            user_name: 'Alice',
            amount: 2000,
            created_at: expect.any(String),
          },
          {
            id: 2,
            expense_id: 1,
            user_id: bobId,
            user_name: 'Bob',
            amount: 2000,
            created_at: expect.any(String),
          },
          {
            id: 3,
            expense_id: 1,
            user_id: charlieId,
            user_name: 'Charlie',
            amount: 2000,
            created_at: expect.any(String),
          },
        ],
      });

      // Verify DB records
      const expenseInDb = db.prepare('SELECT * FROM expenses WHERE id = 1').get() as {
        id: number;
        group_id: number;
        paid_by: number;
        amount: number;
        description: string;
      };
      expect(expenseInDb.amount).toBe(6000);
      expect(expenseInDb.paid_by).toBe(aliceId);
      expect(expenseInDb.description).toBe('Groceries');

      const splitsInDb = db.prepare('SELECT * FROM expense_splits WHERE expense_id = 1 ORDER BY user_id ASC').all() as {
        user_id: number;
        amount: number;
      }[];
      expect(splitsInDb).toHaveLength(3);
      expect(splitsInDb.reduce((sum, s) => sum + s.amount, 0)).toBe(6000);
    });

    it('handles 1000 / 3 odd cent remainder deterministically (334, 333, 333)', async () => {
      const res = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 1000,
          description: 'Dinner',
          paid_by: aliceId,
        });

      expect(res.status).toBe(201);
      expect(res.body.splits.map((s: { amount: number }) => s.amount)).toEqual([334, 333, 333]);
      const totalSplit = res.body.splits.reduce((acc: number, s: { amount: number }) => acc + s.amount, 0);
      expect(totalSplit).toBe(1000);
    });

    it('handles 1 / 3 odd cent remainder deterministically (1, 0, 0)', async () => {
      const res = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 1,
          description: 'Single Penny',
          paid_by: bobId,
        });

      expect(res.status).toBe(201);
      expect(res.body.splits.map((s: { amount: number }) => s.amount)).toEqual([1, 0, 0]);
      const totalSplit = res.body.splits.reduce((acc: number, s: { amount: number }) => acc + s.amount, 0);
      expect(totalSplit).toBe(1);
    });

    it('accepts payer as string name case-insensitively', async () => {
      const res = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 300,
          description: 'Coffee',
          paid_by: 'alice', // lowercase
        });

      expect(res.status).toBe(201);
      expect(res.body.paid_by).toBe(aliceId);
    });

    it('accepts payer as object with id or name', async () => {
      const res1 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 300,
          description: 'Snacks',
          paid_by: { id: bobId },
        });
      expect(res1.status).toBe(201);
      expect(res1.body.paid_by).toBe(bobId);

      const res2 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 300,
          description: 'Drinks',
          paid_by: { name: 'Charlie' },
        });
      expect(res2.status).toBe(201);
      expect(res2.body.paid_by).toBe(charlieId);
    });

    it('accepts payer_id alias in body', async () => {
      const res = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 300,
          description: 'Tea',
          payer_id: aliceId,
        });
      expect(res.status).toBe(201);
      expect(res.body.paid_by).toBe(aliceId);
    });

    it('accepts explicit valid date in YYYY-MM-DD HH:MM:SS format', async () => {
      const customDate = '2026-09-01 15:30:00';
      const res = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 1500,
          description: 'Train Ticket',
          paid_by: aliceId,
          date: customDate,
        });

      expect(res.status).toBe(201);
      expect(res.body.date).toBe(customDate);

      const dbRow = db.prepare('SELECT date FROM expenses WHERE id = ?').get(res.body.id) as { date: string };
      expect(dbRow.date).toBe(customDate);
    });

    it('defaults description to empty string if not provided', async () => {
      const res = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 1200,
          paid_by: aliceId,
        });

      expect(res.status).toBe(201);
      expect(res.body.description).toBe('');
    });

    describe('Payer membership validation', () => {
      it('rejects a non-member payer with 400 Bad Request', async () => {
        // Create an outside user who is not in Trip Group
        const outsideRes = await request(app)
          .post('/groups')
          .send({
            name: 'Other Group',
            members: ['Dave'],
          });
        expect(outsideRes.status).toBe(201);
        const daveId = outsideRes.body.members[0].id;

        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 1000,
            description: 'Intruder Expense',
            paid_by: daveId,
          });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Payer must be a member of the group' });
      });

      it('rejects a non-existent payer ID with 400 Bad Request', async () => {
        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 1000,
            description: 'Ghost Payer',
            paid_by: 99999,
          });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Payer must be a member of the group' });
      });

      it('rejects a non-existent payer name with 400 Bad Request', async () => {
        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 1000,
            description: 'Unknown Name',
            paid_by: 'NonExistentUser',
          });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Payer must be a member of the group' });
      });

      it('rejects missing payer with 400', async () => {
        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 1000,
            description: 'No Payer',
          });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Payer is required' });
      });

      it('rejects empty payer name or malformed payer with 400', async () => {
        const res1 = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({ amount: 1000, paid_by: '   ' });
        expect(res1.status).toBe(400);
        expect(res1.body).toEqual({ error: 'Payer name cannot be empty' });

        const res2 = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({ amount: 1000, paid_by: -5 });
        expect(res2.status).toBe(400);
        expect(res2.body).toEqual({ error: 'Invalid payer ID: must be a positive integer' });

        const res3 = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({ amount: 1000, paid_by: [] });
        expect(res3.status).toBe(400);
        expect(res3.body).toEqual({ error: 'Invalid payer format' });
      });
    });

    describe('Group existence and ID validation', () => {
      it('returns 404 for unknown group ID', async () => {
        const res = await request(app)
          .post('/groups/99999/expenses')
          .send({
            amount: 1000,
            paid_by: aliceId,
          });

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: 'Group not found' });
      });

      it('returns 400 for malformed group ID', async () => {
        const badIds = ['abc', '-1', '0', '1.5', '999999999999999999999999999'];
        for (const bad of badIds) {
          const res = await request(app)
            .post(`/groups/${bad}/expenses`)
            .send({
              amount: 1000,
              paid_by: aliceId,
            });
          expect(res.status).toBe(400);
          expect(res.body).toEqual({ error: 'Invalid group ID: must be a positive integer' });
        }
      });
    });

    describe('Date validation (catching "now" and invalid formats as 4xx)', () => {
      it('rejects "now" and "NOW" with 400 Bad Request instead of surfacing 500 SQLITE_ERROR', async () => {
        const res1 = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 1000,
            paid_by: aliceId,
            date: 'now',
          });
        expect(res1.status).toBe(400);
        expect(res1.body).toEqual({ error: 'Invalid date format: must be YYYY-MM-DD HH:MM:SS' });

        const res2 = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 1000,
            paid_by: aliceId,
            date: 'NOW',
          });
        expect(res2.status).toBe(400);
        expect(res2.body).toEqual({ error: 'Invalid date format: must be YYYY-MM-DD HH:MM:SS' });
      });

      it('rejects midnight spelling 24:00:00 with 400 Bad Request', async () => {
        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 1000,
            paid_by: aliceId,
            date: '2026-09-05 24:00:00',
          });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid date format: must be YYYY-MM-DD HH:MM:SS' });
      });

      it('rejects invalid dates (non-existent calendar date, ISO format, garbage)', async () => {
        const badDates = [
          '2026-02-30 00:00:00',
          '2026-09-05T12:00:00Z',
          '2026-09-05',
          'garbage',
          '2026-13-45 99:99:99',
        ];
        for (const bd of badDates) {
          const res = await request(app)
            .post(`/groups/${groupId}/expenses`)
            .send({
              amount: 1000,
              paid_by: aliceId,
              date: bd,
            });
          expect(res.status).toBe(400);
          expect(res.body).toEqual({ error: 'Invalid date format: must be YYYY-MM-DD HH:MM:SS' });
        }
      });
    });

    describe('Amount validation', () => {
      it('rejects missing amount with 400', async () => {
        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            paid_by: aliceId,
            description: 'No amount',
          });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Amount is required' });
      });

      it('rejects zero amount with 400', async () => {
        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 0,
            paid_by: aliceId,
          });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Amount must be a positive integer in cents' });
      });

      it('rejects negative amount with 400', async () => {
        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: -500,
            paid_by: aliceId,
          });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Amount must be a positive integer in cents' });
      });

      it('rejects fractional cents (floats) with 400', async () => {
        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 10.5,
            paid_by: aliceId,
          });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Amount must be a positive integer in cents' });
      });

      it('rejects string amount with 400', async () => {
        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: '1000',
            paid_by: aliceId,
          });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Amount must be a positive integer in cents' });
      });
    });

    describe('Atomic rollback on failure', () => {
      it('leaves no orphan expense or split row when validation fails', async () => {
        const initialExpenseCount = (db.prepare('SELECT count(*) as c FROM expenses').get() as { c: number }).c;
        const initialSplitCount = (db.prepare('SELECT count(*) as c FROM expense_splits').get() as { c: number }).c;

        const res = await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 1000,
            paid_by: 99999, // Non-member payer
          });
        expect(res.status).toBe(400);

        const finalExpenseCount = (db.prepare('SELECT count(*) as c FROM expenses').get() as { c: number }).c;
        const finalSplitCount = (db.prepare('SELECT count(*) as c FROM expense_splits').get() as { c: number }).c;

        expect(finalExpenseCount).toBe(initialExpenseCount);
        expect(finalSplitCount).toBe(initialSplitCount);
      });

      it('rolls back atomically if database constraint fails mid-transaction', () => {
        // Force a constraint failure during split insertion by breaking expense_splits table
        // We verify that createExpenseTransaction wrapped in db.transaction rolls back expenses row
        const initialExpenseCount = (db.prepare('SELECT count(*) as c FROM expenses').get() as { c: number }).c;

        // Temporarily add a trigger on expense_splits that aborts
        db.exec(`
          CREATE TRIGGER abort_splits BEFORE INSERT ON expense_splits
          BEGIN
            SELECT RAISE(ABORT, 'Simulated mid-transaction split failure');
          END;
        `);

        // Send request that will trigger the abort in transaction
        return request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 3000,
            paid_by: aliceId,
            description: 'Trigger test',
          })
          .then((res) => {
            expect(res.status).toBe(500);

            // Assert no expense was created in expenses table
            const finalExpenseCount = (db.prepare('SELECT count(*) as c FROM expenses').get() as { c: number }).c;
            expect(finalExpenseCount).toBe(initialExpenseCount);

            // Clean up trigger
            db.exec('DROP TRIGGER abort_splits');
          });
      });
    });
  });

  describe('GET /groups/:id/expenses - List group expenses', () => {
    let groupId: number;
    let aliceId: number;
    let bobId: number;
    let charlieId: number;

    beforeEach(async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({
          name: 'Weekend Getaway',
          members: ['Alice', 'Bob', 'Charlie'],
        });
      groupId = groupRes.body.id;
      aliceId = (groupRes.body.members as Member[]).find((m) => m.name === 'Alice')!.id;
      bobId = (groupRes.body.members as Member[]).find((m) => m.name === 'Bob')!.id;
      charlieId = (groupRes.body.members as Member[]).find((m) => m.name === 'Charlie')!.id;
    });

    it('returns empty array when group has no expenses', async () => {
      const res = await request(app).get(`/groups/${groupId}/expenses`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 404 when group does not exist', async () => {
      const res = await request(app).get('/groups/99999/expenses');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Group not found' });
    });

    it('returns 400 for malformed group IDs', async () => {
      for (const badId of ['abc', '-1', '0', '1.5', 'true', 'null']) {
        const res = await request(app).get(`/groups/${badId}/expenses`);
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid group ID: must be a positive integer' });
      }
    });

    it('round-trips create and list with matching response shape and split detail', async () => {
      const createRes = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 6000,
          description: 'Groceries',
          paid_by: aliceId,
          date: '2026-09-05 19:00:00',
        });
      expect(createRes.status).toBe(201);
      const createdExpense = createRes.body;

      const listRes = await request(app).get(`/groups/${groupId}/expenses`);
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0]).toEqual(createdExpense);

      // Verify exact fields
      const item = listRes.body[0];
      expect(item).toMatchObject({
        id: createdExpense.id,
        group_id: groupId,
        paid_by: aliceId,
        amount: 6000,
        description: 'Groceries',
        date: '2026-09-05 19:00:00',
        created_at: expect.any(String),
      });
      expect(item.splits).toHaveLength(3);
      expect(item.splits[0]).toEqual({
        id: expect.any(Number),
        expense_id: item.id,
        user_id: aliceId,
        user_name: 'Alice',
        amount: 2000,
        created_at: expect.any(String),
      });
      expect(item.splits[1]).toEqual({
        id: expect.any(Number),
        expense_id: item.id,
        user_id: bobId,
        user_name: 'Bob',
        amount: 2000,
        created_at: expect.any(String),
      });
      expect(item.splits[2]).toEqual({
        id: expect.any(Number),
        expense_id: item.id,
        user_id: charlieId,
        user_name: 'Charlie',
        amount: 2000,
        created_at: expect.any(String),
      });
    });

    it('orders expenses by user-supplied date DESC, not created_at or id', async () => {
      // Insert in deliberate order: oldest first, then newest, then middle
      const expOld = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 1000,
          description: 'Old expense',
          paid_by: aliceId,
          date: '2026-09-01 10:00:00',
        });
      const expNew = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 2000,
          description: 'New expense',
          paid_by: bobId,
          date: '2026-09-05 10:00:00',
        });
      const expMid = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 3000,
          description: 'Mid expense',
          paid_by: charlieId,
          date: '2026-09-03 10:00:00',
        });

      const listRes = await request(app).get(`/groups/${groupId}/expenses`);
      expect(listRes.status).toBe(200);
      const returnedIds = (listRes.body as Expense[]).map((e) => e.id);
      // Newest date (Sep 5) -> Mid date (Sep 3) -> Old date (Sep 1)
      expect(returnedIds).toEqual([expNew.body.id, expMid.body.id, expOld.body.id]);
      expect((listRes.body as Expense[]).map((e) => e.date)).toEqual([
        '2026-09-05 10:00:00',
        '2026-09-03 10:00:00',
        '2026-09-01 10:00:00',
      ]);
    });

    it('breaks ties using id DESC when default CURRENT_TIMESTAMP timestamps share the same second', async () => {
      // Create three expenses in rapid succession without specifying date
      const exp1 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 1000, paid_by: aliceId, description: 'First' });
      const exp2 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 2000, paid_by: bobId, description: 'Second' });
      const exp3 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 3000, paid_by: charlieId, description: 'Third' });

      expect(exp1.status).toBe(201);
      expect(exp2.status).toBe(201);
      expect(exp3.status).toBe(201);

      // Verify they got the exact same timestamp string
      expect(exp1.body.date).toBe(exp2.body.date);
      expect(exp2.body.date).toBe(exp3.body.date);

      const listRes = await request(app).get(`/groups/${groupId}/expenses`);
      expect(listRes.status).toBe(200);
      const returnedIds = (listRes.body as Expense[]).map((e) => e.id);
      // Pinned same-second requirement: newest id DESC first
      expect(returnedIds).toEqual([exp3.body.id, exp2.body.id, exp1.body.id]);
    });

    it('breaks ties using id DESC when expenses have identical user-specified timestamps', async () => {
      const fixedTimestamp = '2026-09-05 12:00:00';
      const exp1 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 1000, paid_by: aliceId, date: fixedTimestamp, description: 'A' });
      const exp2 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 2000, paid_by: bobId, date: fixedTimestamp, description: 'B' });
      const exp3 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 3000, paid_by: charlieId, date: fixedTimestamp, description: 'C' });
      const exp4 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 4000, paid_by: aliceId, date: fixedTimestamp, description: 'D' });

      const listRes = await request(app).get(`/groups/${groupId}/expenses`);
      expect(listRes.status).toBe(200);
      const returnedIds = (listRes.body as Expense[]).map((e) => e.id);
      expect(returnedIds).toEqual([exp4.body.id, exp3.body.id, exp2.body.id, exp1.body.id]);
    });

    it('enforces id DESC tiebreak in query even if the composite date index is absent', async () => {
      // Dropping the composite index verifies that the SQL query itself explicitly enforces
      // ORDER BY date DESC, id DESC rather than accidentally inheriting index scan order
      db.exec('DROP INDEX idx_expenses_group_id_date_id');

      const fixedTimestamp = '2026-09-05 14:00:00';
      const exp1 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 1000, paid_by: aliceId, date: fixedTimestamp, description: 'E1' });
      const exp2 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 2000, paid_by: bobId, date: fixedTimestamp, description: 'E2' });
      const exp3 = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 3000, paid_by: charlieId, date: fixedTimestamp, description: 'E3' });

      const listRes = await request(app).get(`/groups/${groupId}/expenses`);
      expect(listRes.status).toBe(200);
      const returnedIds = (listRes.body as Expense[]).map((e) => e.id);
      expect(returnedIds).toEqual([exp3.body.id, exp2.body.id, exp1.body.id]);
    });

    it('isolates expenses and splits by group so groups do not leak into each other', async () => {
      const otherGroupRes = await request(app)
        .post('/groups')
        .send({ name: 'Other Group', members: ['Dave', 'Eve'] });
      const otherGroupId = otherGroupRes.body.id;
      const daveId = (otherGroupRes.body.members as Member[]).find((m) => m.name === 'Dave')!.id;

      await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({ amount: 1500, paid_by: aliceId, description: 'Group 1 Expense' });

      await request(app)
        .post(`/groups/${otherGroupId}/expenses`)
        .send({ amount: 2500, paid_by: daveId, description: 'Group 2 Expense' });

      const g1Res = await request(app).get(`/groups/${groupId}/expenses`);
      const g2Res = await request(app).get(`/groups/${otherGroupId}/expenses`);

      expect(g1Res.status).toBe(200);
      expect(g2Res.status).toBe(200);
      expect(g1Res.body).toHaveLength(1);
      expect(g2Res.body).toHaveLength(1);
      expect(g1Res.body[0].group_id).toBe(groupId);
      expect(g1Res.body[0].description).toBe('Group 1 Expense');
      expect(g1Res.body[0].splits).toHaveLength(3);
      expect(g1Res.body[0].splits.reduce((acc: number, s: ExpenseSplit) => acc + s.amount, 0)).toBe(1500);

      expect(g2Res.body[0].group_id).toBe(otherGroupId);
      expect(g2Res.body[0].description).toBe('Group 2 Expense');
      expect(g2Res.body[0].splits).toHaveLength(2);
      expect(g2Res.body[0].splits.reduce((acc: number, s: ExpenseSplit) => acc + s.amount, 0)).toBe(2500);
      expect(g2Res.body[0].splits.map((s: ExpenseSplit) => s.user_name).sort()).toEqual(['Dave', 'Eve']);
    });

    it('correctly associates splits across many expenses without per-expense queries', async () => {
      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: i * 300,
            paid_by: i % 2 === 0 ? bobId : aliceId,
            description: `Expense ${i}`,
            date: `2026-09-0${i} 12:00:00`,
          });
      }

      const listRes = await request(app).get(`/groups/${groupId}/expenses`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(5);

      for (const exp of listRes.body as Expense[]) {
        expect(exp.splits).toHaveLength(3);
        const splitSum = exp.splits.reduce((acc: number, s: ExpenseSplit) => acc + s.amount, 0);
        expect(splitSum).toBe(exp.amount);
        for (const s of exp.splits) {
          expect(s.expense_id).toBe(exp.id);
          expect(['Alice', 'Bob', 'Charlie']).toContain(s.user_name);
        }
      }
    });
  });
});
