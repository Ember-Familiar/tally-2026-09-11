import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';

export interface Member {
  id: number;
  name: string;
}

export interface Group {
  id: number;
  name: string;
  created_at: string;
  members: Member[];
}

export interface ParsedMemberInput {
  id?: number;
  name?: string;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function parseId(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    if (!/^\d+$/.test(raw)) {
      return null;
    }
    const num = Number(raw);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
  }
  return null;
}

export function validateAndParseMembers(members: unknown): ParsedMemberInput[] {
  if (members === undefined || members === null) {
    throw new ValidationError('Members list is required');
  }
  if (!Array.isArray(members)) {
    throw new ValidationError('Members must be an array');
  }
  if (members.length === 0) {
    throw new ValidationError('Group must have at least one member');
  }

  const parsedList: ParsedMemberInput[] = [];
  const seenNames = new Set<string>();
  const seenIds = new Set<number>();

  for (let i = 0; i < members.length; i++) {
    const m = members[i];

    if (typeof m === 'string') {
      const trimmed = m.trim();
      if (!trimmed) {
        throw new ValidationError('Member name cannot be empty');
      }
      const lower = trimmed.toLowerCase();
      if (seenNames.has(lower)) {
        throw new ValidationError(`Duplicate member in request: ${trimmed}`);
      }
      seenNames.add(lower);
      parsedList.push({ name: trimmed });
    } else if (typeof m === 'number') {
      const id = parseId(m);
      if (id === null) {
        throw new ValidationError('Invalid member ID: must be a positive integer');
      }
      if (seenIds.has(id)) {
        throw new ValidationError(`Duplicate member ID in request: ${id}`);
      }
      seenIds.add(id);
      parsedList.push({ id });
    } else if (typeof m === 'object' && m !== null && !Array.isArray(m)) {
      const obj = m as Record<string, unknown>;
      let memberId: number | undefined;
      let memberName: string | undefined;

      if ('id' in obj && obj.id !== undefined && obj.id !== null) {
        const id = parseId(obj.id);
        if (id === null) {
          throw new ValidationError('Invalid member ID: must be a positive integer');
        }
        memberId = id;
      }

      if ('name' in obj && obj.name !== undefined && obj.name !== null) {
        if (typeof obj.name !== 'string') {
          throw new ValidationError('Member name must be a string');
        }
        const trimmed = obj.name.trim();
        if (!trimmed) {
          throw new ValidationError('Member name cannot be empty');
        }
        memberName = trimmed;
      }

      if (memberId === undefined && memberName === undefined) {
        throw new ValidationError('Member must have a name or id');
      }

      if (memberId !== undefined) {
        if (seenIds.has(memberId)) {
          throw new ValidationError(`Duplicate member ID in request: ${memberId}`);
        }
        seenIds.add(memberId);
      }

      if (memberName !== undefined) {
        const lower = memberName.toLowerCase();
        if (seenNames.has(lower)) {
          throw new ValidationError(`Duplicate member in request: ${memberName}`);
        }
        seenNames.add(lower);
      }

      parsedList.push({ id: memberId, name: memberName });
    } else {
      throw new ValidationError('Invalid member format');
    }
  }

  return parsedList;
}

export function createGroupRouter(db: Database.Database): Router {
  const router = Router();

  const selectGroupById = db.prepare('SELECT id, name, created_at FROM groups WHERE id = ?');
  const selectGroupMembers = db.prepare(
    'SELECT u.id, u.name FROM users u JOIN group_members gm ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.id ASC'
  );
  const selectAllGroups = db.prepare('SELECT id, name, created_at FROM groups ORDER BY id ASC');

  const insertGroupStmt = db.prepare('INSERT INTO groups (name) VALUES (?)');
  const insertMemberStmt = db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)');
  const selectUserById = db.prepare('SELECT id, name FROM users WHERE id = ?');
  const selectUserByName = db.prepare('SELECT id, name FROM users WHERE name = ? COLLATE NOCASE');
  const insertUserStmt = db.prepare('INSERT INTO users (name) VALUES (?)');

  // Single SQLite transaction for group and member insertion
  const createGroupTransaction = db.transaction(
    (groupName: string, memberInputs: ParsedMemberInput[]): Group => {
      const groupInfo = insertGroupStmt.run(groupName);
      const groupId = Number(groupInfo.lastInsertRowid);

      const resolvedUserIds = new Set<number>();

      for (const item of memberInputs) {
        let userId: number;

        if (item.id !== undefined) {
          const user = selectUserById.get(item.id) as { id: number; name: string } | undefined;
          if (!user) {
            throw new ValidationError(`User with ID ${item.id} does not exist`);
          }
          userId = user.id;
        } else if (item.name !== undefined) {
          const existingUser = selectUserByName.get(item.name) as { id: number; name: string } | undefined;
          if (existingUser) {
            userId = existingUser.id;
          } else {
            const userInfo = insertUserStmt.run(item.name);
            userId = Number(userInfo.lastInsertRowid);
          }
        } else {
          throw new ValidationError('Member must have a name or id');
        }

        if (resolvedUserIds.has(userId)) {
          throw new ValidationError('Duplicate member in group');
        }
        resolvedUserIds.add(userId);

        insertMemberStmt.run(groupId, userId);
      }

      const createdGroup = selectGroupById.get(groupId) as { id: number; name: string; created_at: string };
      const members = selectGroupMembers.all(groupId) as Member[];

      return {
        id: createdGroup.id,
        name: createdGroup.name,
        created_at: createdGroup.created_at,
        members,
      };
    }
  );

  // POST /groups - Create group with name and initial members
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, members } = req.body ?? {};

      if (name === undefined || name === null) {
        res.status(400).json({ error: 'Group name is required' });
        return;
      }
      if (typeof name !== 'string') {
        res.status(400).json({ error: 'Group name must be a string' });
        return;
      }
      const trimmedName = name.trim();
      if (!trimmedName) {
        res.status(400).json({ error: 'Group name cannot be empty' });
        return;
      }

      let parsedMembers: ParsedMemberInput[];
      try {
        parsedMembers = validateAndParseMembers(members);
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }

      try {
        const group = createGroupTransaction(trimmedName, parsedMembers);
        res.status(201).json(group);
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  // GET /groups - List all groups
  router.get('/', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const groups = selectAllGroups.all() as { id: number; name: string; created_at: string }[];
      const result: Group[] = groups.map((g) => ({
        id: g.id,
        name: g.name,
        created_at: g.created_at,
        members: selectGroupMembers.all(g.id) as Member[],
      }));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /groups/:id - Detail for a single group
  router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params.id;
      const groupId = parseId(rawId);
      if (groupId === null) {
        res.status(400).json({ error: 'Invalid group ID: must be a positive integer' });
        return;
      }

      const group = selectGroupById.get(groupId) as { id: number; name: string; created_at: string } | undefined;
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const members = selectGroupMembers.all(groupId) as Member[];
      res.status(200).json({
        id: group.id,
        name: group.name,
        created_at: group.created_at,
        members,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
