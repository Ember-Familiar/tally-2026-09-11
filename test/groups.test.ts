import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../src/app';
import { createDatabase } from '../src/db';
import { parseId } from '../src/routes/groups';

describe('Group Routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDatabase(':memory:');
    app = createApp(db);
  });

  describe('parseId helper', () => {
    it('accepts valid positive integers as strings and numbers', () => {
      expect(parseId('1')).toBe(1);
      expect(parseId('42')).toBe(42);
      expect(parseId(1)).toBe(1);
      expect(parseId(999)).toBe(999);
    });

    it('rejects non-positive, floating point, non-numeric, or out-of-bounds inputs', () => {
      expect(parseId('0')).toBeNull();
      expect(parseId(0)).toBeNull();
      expect(parseId('-1')).toBeNull();
      expect(parseId(-1)).toBeNull();
      expect(parseId('1.5')).toBeNull();
      expect(parseId(1.5)).toBeNull();
      expect(parseId('abc')).toBeNull();
      expect(parseId('')).toBeNull();
      expect(parseId(' 1 ')).toBeNull();
      expect(parseId('1a')).toBeNull();
      expect(parseId('999999999999999999999999999')).toBeNull();
      expect(parseId(null)).toBeNull();
      expect(parseId(undefined)).toBeNull();
      expect(parseId({})).toBeNull();
    });
  });

  describe('POST /groups', () => {
    it('creates a new group with initial string members and returns 201', async () => {
      const res = await request(app)
        .post('/groups')
        .send({
          name: 'Ski Trip',
          members: ['Alice', 'Bob', 'Charlie'],
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: 1,
        name: 'Ski Trip',
        created_at: expect.any(String),
        members: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ],
      });

      // Verify persistence in SQLite
      const groupInDb = db.prepare('SELECT id, name, created_at FROM groups WHERE id = 1').get() as {
        id: number;
        name: string;
      };
      expect(groupInDb.name).toBe('Ski Trip');

      const membersInDb = db
        .prepare(
          'SELECT u.id, u.name FROM users u JOIN group_members gm ON u.id = gm.user_id WHERE gm.group_id = 1 ORDER BY u.id ASC'
        )
        .all() as { id: number; name: string }[];
      expect(membersInDb).toHaveLength(3);
      expect(membersInDb.map((m) => m.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('reuses existing users by name without creating duplicate user rows', async () => {
      // First group creates Alice and Bob
      const res1 = await request(app)
        .post('/groups')
        .send({
          name: 'Group 1',
          members: ['Alice', 'Bob'],
        });
      expect(res1.status).toBe(201);

      // Second group reuses Alice and creates Charlie
      const res2 = await request(app)
        .post('/groups')
        .send({
          name: 'Group 2',
          members: ['Alice', 'Charlie'],
        });
      expect(res2.status).toBe(201);
      expect(res2.body.members).toEqual([
        { id: 1, name: 'Alice' },
        { id: 3, name: 'Charlie' },
      ]);

      // Total distinct users in DB should be exactly 3: Alice, Bob, Charlie
      const allUsers = db.prepare('SELECT id, name FROM users ORDER BY id ASC').all();
      expect(allUsers).toHaveLength(3);
    });

    it('reuses existing users by name case-insensitively', async () => {
      // First group creates Alice
      const res1 = await request(app)
        .post('/groups')
        .send({
          name: 'Group 1',
          members: ['Alice'],
        });
      expect(res1.status).toBe(201);
      expect(res1.body.members).toEqual([{ id: 1, name: 'Alice' }]);

      // Second group uses 'alice' in lowercase, which should reuse Alice (id: 1)
      const res2 = await request(app)
        .post('/groups')
        .send({
          name: 'Group 2',
          members: ['alice'],
        });
      expect(res2.status).toBe(201);
      expect(res2.body.members).toEqual([{ id: 1, name: 'Alice' }]);

      // Verify that no duplicate user row was created
      const allUsers = db.prepare('SELECT id, name FROM users ORDER BY id ASC').all() as { id: number; name: string }[];
      expect(allUsers).toHaveLength(1);
      expect(allUsers[0]).toEqual({ id: 1, name: 'Alice' });
    });

    it('creates a group using member objects and existing user IDs', async () => {
      // Pre-seed a user
      db.prepare('INSERT INTO users (name) VALUES (?)').run('Existing User');

      const res = await request(app)
        .post('/groups')
        .send({
          name: 'Mixed Group',
          members: [
            1, // By user ID
            { name: 'New User' }, // By object with name
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.members).toEqual([
        { id: 1, name: 'Existing User' },
        { id: 2, name: 'New User' },
      ]);
    });

    describe('Atomicity on failure', () => {
      it('rolls back completely and leaves no orphan group or user when member insertion fails', async () => {
        const initialGroupCount = (db.prepare('SELECT count(*) as c FROM groups').get() as { c: number }).c;
        const initialMemberCount = (db.prepare('SELECT count(*) as c FROM group_members').get() as { c: number }).c;
        const initialUserCount = (db.prepare('SELECT count(*) as c FROM users').get() as { c: number }).c;

        // Attempt creation with a valid new user name and an invalid non-existent user ID
        const res = await request(app)
          .post('/groups')
          .send({
            name: 'Doomed Group',
            members: ['ValidUser', 99999],
          });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'User with ID 99999 does not exist' });

        // Assert no group row was left behind
        const finalGroupCount = (db.prepare('SELECT count(*) as c FROM groups').get() as { c: number }).c;
        expect(finalGroupCount).toBe(initialGroupCount);

        // Assert no group_members row was left behind
        const finalMemberCount = (db.prepare('SELECT count(*) as c FROM group_members').get() as { c: number }).c;
        expect(finalMemberCount).toBe(initialMemberCount);

        // Assert ValidUser insertion was rolled back
        const finalUserCount = (db.prepare('SELECT count(*) as c FROM users').get() as { c: number }).c;
        expect(finalUserCount).toBe(initialUserCount);

        const orphanUser = db.prepare('SELECT * FROM users WHERE name = ?').get('ValidUser');
        expect(orphanUser).toBeUndefined();
      });

      it('rolls back group creation if duplicate resolved members occur mid-transaction', async () => {
        db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(1, 'Alice');

        // Pass ID 1 and name "Alice" which resolves to user ID 1
        const res = await request(app)
          .post('/groups')
          .send({
            name: 'Dup Group',
            members: [1, 'Alice'],
          });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Duplicate member in group' });

        // Assert group was not created
        const group = db.prepare('SELECT * FROM groups WHERE name = ?').get('Dup Group');
        expect(group).toBeUndefined();
      });
    });

    describe('Validation', () => {
      it('rejects missing name', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ members: ['Alice'] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Group name is required' });
      });

      it('rejects non-string name', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 12345, members: ['Alice'] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Group name must be a string' });
      });

      it('rejects empty name string', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: '', members: ['Alice'] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Group name cannot be empty' });
      });

      it('rejects whitespace-only name string', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: '   ', members: ['Alice'] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Group name cannot be empty' });
      });

      it('rejects missing members array', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Valid Name' });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Members list is required' });
      });

      it('rejects non-array members', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Valid Name', members: 'Alice' });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Members must be an array' });
      });

      it('rejects empty members array', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Valid Name', members: [] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Group must have at least one member' });
      });

      it('rejects member with empty name string', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Trip', members: ['Alice', '   '] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Member name cannot be empty' });
      });

      it('rejects member object with non-string name', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Trip', members: [{ name: 123 }] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Member name must be a string' });
      });

      it('rejects member object with empty name', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Trip', members: [{ name: '  ' }] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Member name cannot be empty' });
      });

      it('rejects member object without name or id', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Trip', members: [{}] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Member must have a name or id' });
      });

      it('rejects malformed member ID (negative, float, zero)', async () => {
        const cases = [-1, 0, 1.5];
        for (const badId of cases) {
          const res = await request(app)
            .post('/groups')
            .send({ name: 'Trip', members: [badId] });
          expect(res.status).toBe(400);
          expect(res.body).toEqual({ error: 'Invalid member ID: must be a positive integer' });
        }
      });

      it('rejects malformed member ID in object', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Trip', members: [{ id: 'not-a-number' }] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid member ID: must be a positive integer' });
      });

      it('rejects invalid member data types (null, boolean, nested array)', async () => {
        const invalidTypes = [null, true, ['nested']];
        for (const inv of invalidTypes) {
          const res = await request(app)
            .post('/groups')
            .send({ name: 'Trip', members: [inv] });
          expect(res.status).toBe(400);
          expect(res.body).toEqual({ error: 'Invalid member format' });
        }
      });

      it('rejects duplicate member names in request', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Trip', members: ['Alice', 'Alice'] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Duplicate member in request: Alice' });
      });

      it('rejects duplicate member names case-insensitively in request', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Trip', members: ['Alice', 'alice'] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Duplicate member in request: alice' });
      });

      it('rejects duplicate member IDs in request', async () => {
        const res = await request(app)
          .post('/groups')
          .send({ name: 'Trip', members: [1, 1] });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Duplicate member ID in request: 1' });
      });

      it('rejects malformed JSON payload with 400', async () => {
        const res = await request(app)
          .post('/groups')
          .set('Content-Type', 'application/json')
          .send('{ bad json: ');
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid JSON payload' });
      });
    });
  });

  describe('GET /groups (List)', () => {
    it('returns empty array 200 when no groups exist', async () => {
      const res = await request(app).get('/groups');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns all created groups with members ordered by id ASC', async () => {
      await request(app)
        .post('/groups')
        .send({ name: 'Group A', members: ['Alice'] });
      await request(app)
        .post('/groups')
        .send({ name: 'Group B', members: ['Bob', 'Charlie'] });

      const res = await request(app).get('/groups');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].name).toBe('Group A');
      expect(res.body[0].members).toEqual([{ id: 1, name: 'Alice' }]);
      expect(res.body[1].name).toBe('Group B');
      expect(res.body[1].members).toEqual([
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ]);
    });
  });

  describe('GET /groups/:id (Detail)', () => {
    it('returns 200 and group with members for existing id', async () => {
      const created = await request(app)
        .post('/groups')
        .send({ name: 'Camping', members: ['Alice', 'Bob'] });

      const groupId = created.body.id;
      const res = await request(app).get(`/groups/${groupId}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: groupId,
        name: 'Camping',
        created_at: expect.any(String),
        members: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      });
    });

    it('returns 404 for unknown group id', async () => {
      const res = await request(app).get('/groups/99999');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Group not found' });
    });

    it('returns 400 for malformed group id', async () => {
      const malformedIds = ['abc', '-1', '0', '1.5', '999999999999999999999999999'];
      for (const badId of malformedIds) {
        const res = await request(app).get(`/groups/${badId}`);
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid group ID: must be a positive integer' });
      }
    });
  });
});
