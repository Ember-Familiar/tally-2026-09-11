import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import {
  calculateBalances,
  BalanceEngineError,
  SettlementInput,
  calculateExactSplits,
  calculateRatioSplits,
  calculatePercentageSplits,
  ExactSplitItem,
  RatioSplitItem,
  PercentageSplitItem,
} from '../balances';

export interface Settlement {
  id: number;
  group_id: number;
  from: number;
  to: number;
  from_user_id: number;
  to_user_id: number;
  from_name: string;
  to_name: string;
  amount: number;
  description: string;
  date: string;
  created_at: string;
}

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

export interface ExpenseSplit {
  id: number;
  expense_id: number;
  user_id: number;
  user_name: string;
  amount: number;
  created_at: string;
}

export interface Expense {
  id: number;
  group_id: number;
  paid_by: number;
  amount: number;
  description: string;
  date: string;
  created_at: string;
  splits: ExpenseSplit[];
}

export interface CalculatedSplit {
  userId: number;
  amount: number;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function isValidDate(dateStr: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(dateStr);
  if (!match) {
    return false;
  }
  const [, yStr, mStr, dStr, hStr, minStr, sStr] = match;
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const hour = Number(hStr);
  const minute = Number(minStr);
  const second = Number(sStr);

  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  const dateObj = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    dateObj.getUTCFullYear() !== year ||
    dateObj.getUTCMonth() !== month - 1 ||
    dateObj.getUTCDate() !== day ||
    dateObj.getUTCHours() !== hour ||
    dateObj.getUTCMinutes() !== minute ||
    dateObj.getUTCSeconds() !== second
  ) {
    return false;
  }
  return true;
}

export function parseDate(rawDate: unknown): string | undefined {
  if (rawDate === undefined || rawDate === null) {
    return undefined;
  }
  if (typeof rawDate !== 'string') {
    throw new ValidationError('Date must be a string');
  }
  const trimmed = rawDate.trim();
  if (!trimmed) {
    throw new ValidationError('Date cannot be empty');
  }
  if (!isValidDate(trimmed)) {
    throw new ValidationError('Invalid date format: must be YYYY-MM-DD HH:MM:SS');
  }
  return trimmed;
}

export function parseAmount(rawAmount: unknown): number {
  if (rawAmount === undefined || rawAmount === null) {
    throw new ValidationError('Amount is required');
  }
  if (typeof rawAmount !== 'number' || !Number.isSafeInteger(rawAmount) || rawAmount <= 0) {
    throw new ValidationError('Amount must be a positive integer in cents');
  }
  return rawAmount;
}

export function parseDescription(rawDesc: unknown): string {
  if (rawDesc === undefined || rawDesc === null) {
    return '';
  }
  if (typeof rawDesc !== 'string') {
    throw new ValidationError('Description must be a string');
  }
  return rawDesc.trim();
}

export function calculateEqualSplits(totalAmount: number, memberUserIds: number[]): CalculatedSplit[] {
  if (memberUserIds.length === 0) {
    throw new ValidationError('Group has no members to split expense between');
  }
  const n = memberUserIds.length;
  const base = Math.floor(totalAmount / n);
  const remainder = totalAmount % n;

  // Remainder distribution: first remainder members by user_id ASC each receive +1 cent
  const sortedIds = [...memberUserIds].sort((a, b) => a - b);

  return sortedIds.map((userId, index) => ({
    userId,
    amount: base + (index < remainder ? 1 : 0),
  }));
}

export function parseId(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    if (!/^[1-9]\d*$/.test(raw)) {
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
  const selectUserByName = db.prepare('SELECT id, name FROM users WHERE name = ? COLLATE NOCASE ORDER BY id ASC LIMIT 1');
  const selectGroupMemberByName = db.prepare(
    'SELECT u.id, u.name FROM users u JOIN group_members gm ON u.id = gm.user_id WHERE gm.group_id = ? AND u.name = ? COLLATE NOCASE ORDER BY u.id ASC LIMIT 1'
  );
  const insertUserStmt = db.prepare('INSERT INTO users (name) VALUES (?)');

  const insertExpenseStmt = db.prepare(
    'INSERT INTO expenses (group_id, paid_by, amount, description) VALUES (?, ?, ?, ?)'
  );
  const insertExpenseWithDateStmt = db.prepare(
    'INSERT INTO expenses (group_id, paid_by, amount, description, date) VALUES (?, ?, ?, ?, ?)'
  );
  const insertSplitStmt = db.prepare(
    'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?)'
  );
  const selectExpenseById = db.prepare(
    'SELECT id, group_id, paid_by, amount, description, date, created_at FROM expenses WHERE id = ?'
  );
  const selectSplitsByExpenseId = db.prepare(
    'SELECT es.id, es.expense_id, es.user_id, u.name as user_name, es.amount, es.created_at FROM expense_splits es JOIN users u ON es.user_id = u.id WHERE es.expense_id = ? ORDER BY es.id ASC'
  );
  const selectGroupMemberIds = db.prepare(
    'SELECT user_id FROM group_members WHERE group_id = ? ORDER BY user_id ASC'
  );
  const checkMembershipStmt = db.prepare(
    'SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?'
  );
  const selectExpensesByGroupId = db.prepare(
    'SELECT id, group_id, paid_by, amount, description, date, created_at FROM expenses WHERE group_id = ? ORDER BY date DESC, id DESC'
  );
  const selectSplitsByGroupId = db.prepare(
    'SELECT es.id, es.expense_id, es.user_id, u.name as user_name, es.amount, es.created_at FROM expense_splits es JOIN users u ON es.user_id = u.id JOIN expenses e ON es.expense_id = e.id WHERE e.group_id = ? ORDER BY es.id ASC'
  );
  const insertSettlementStmt = db.prepare(
    'INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, description) VALUES (?, ?, ?, ?, ?)'
  );
  const insertSettlementWithDateStmt = db.prepare(
    'INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, description, date) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const selectSettlementById = db.prepare(
    `SELECT s.id, s.group_id, s.from_user_id, s.to_user_id, s.amount, s.description, s.date, s.created_at,
            u1.name as from_name, u2.name as to_name
     FROM settlements s
     JOIN users u1 ON s.from_user_id = u1.id
     JOIN users u2 ON s.to_user_id = u2.id
     WHERE s.id = ?`
  );
  const selectSettlementsByGroupId = db.prepare(
    `SELECT s.id, s.group_id, s.from_user_id, s.to_user_id, s.amount, s.description, s.date, s.created_at,
            u1.name as from_name, u2.name as to_name
     FROM settlements s
     JOIN users u1 ON s.from_user_id = u1.id
     JOIN users u2 ON s.to_user_id = u2.id
     WHERE s.group_id = ?
     ORDER BY s.date DESC, s.id DESC`
  );

  const createExpenseTransaction = db.transaction(
    (
      groupId: number,
      paidBy: number,
      amount: number,
      description: string,
      date: string | undefined,
      splits: CalculatedSplit[]
    ): Expense => {
      let expenseId: number;
      if (date !== undefined) {
        const expInfo = insertExpenseWithDateStmt.run(groupId, paidBy, amount, description, date);
        expenseId = Number(expInfo.lastInsertRowid);
      } else {
        const expInfo = insertExpenseStmt.run(groupId, paidBy, amount, description);
        expenseId = Number(expInfo.lastInsertRowid);
      }

      for (const s of splits) {
        insertSplitStmt.run(expenseId, s.userId, s.amount);
      }

      const createdExpense = selectExpenseById.get(expenseId) as {
        id: number;
        group_id: number;
        paid_by: number;
        amount: number;
        description: string;
        date: string;
        created_at: string;
      };

      const expenseSplits = selectSplitsByExpenseId.all(expenseId) as ExpenseSplit[];

      return {
        id: createdExpense.id,
        group_id: createdExpense.group_id,
        paid_by: createdExpense.paid_by,
        amount: createdExpense.amount,
        description: createdExpense.description,
        date: createdExpense.date,
        created_at: createdExpense.created_at,
        splits: expenseSplits,
      };
    }
  );

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

  function getGroupExpensesWithSplits(groupId: number): Expense[] {
    const expenses = selectExpensesByGroupId.all(groupId) as {
      id: number;
      group_id: number;
      paid_by: number;
      amount: number;
      description: string;
      date: string;
      created_at: string;
    }[];

    if (expenses.length === 0) {
      return [];
    }

    const splits = selectSplitsByGroupId.all(groupId) as ExpenseSplit[];
    const splitsByExpenseId = new Map<number, ExpenseSplit[]>();
    for (const split of splits) {
      let list = splitsByExpenseId.get(split.expense_id);
      if (!list) {
        list = [];
        splitsByExpenseId.set(split.expense_id, list);
      }
      list.push(split);
    }

    return expenses.map((exp) => ({
      id: exp.id,
      group_id: exp.group_id,
      paid_by: exp.paid_by,
      amount: exp.amount,
      description: exp.description,
      date: exp.date,
      created_at: exp.created_at,
      splits: splitsByExpenseId.get(exp.id) ?? [],
    }));
  }

  const EXPENSE_PAYER_ALIASES = ['paid_by', 'payer_id', 'payer'];
  const SETTLE_FROM_ALIASES = ['from', 'from_user_id', 'paid_by', 'payer_id', 'payer'];
  const SETTLE_TO_ALIASES = ['to', 'to_user_id', 'paid_to', 'payee_id', 'payee', 'received_by'];
  const SPLIT_PARTICIPANT_ALIASES = ['user_id', 'userId', 'user', 'member_id', 'member', 'id', 'name'];
  const ALLOWED_SPLIT_ITEM_KEYS = new Set([
    'user_id',
    'userId',
    'user',
    'member_id',
    'member',
    'id',
    'name',
    'amount',
    'split_amount',
    'ratio',
    'shares',
    'weight',
    'percentage',
    'percent',
    'pct',
  ]);
  const DISALLOWED_TOP_LEVEL_SPLIT_KEYS = [
    'ratio',
    'share',
    'weight',
    'percentage',
    'percent',
    'pct',
    'split_amount',
  ] as const;

  function resolveGroupParticipant(
    rawOrBody: unknown,
    roleLabel: string,
    groupId: number,
    aliasKeys?: string[],
  ): number {
    let raw = rawOrBody;
    if (aliasKeys && rawOrBody && typeof rawOrBody === 'object' && !Array.isArray(rawOrBody)) {
      const rec = rawOrBody as Record<string, unknown>;
      raw = undefined;
      for (const key of aliasKeys) {
        if (rec[key] !== undefined && rec[key] !== null) {
          raw = rec[key];
          break;
        }
      }
    }

    if (raw === undefined || raw === null || raw === '') {
      throw new ValidationError(`${roleLabel} is required`);
    }

    const roleLower = roleLabel.toLowerCase();
    let userId: number;

    if (typeof raw === 'number') {
      const parsed = parseId(raw);
      if (parsed === null) {
        throw new ValidationError(`Invalid ${roleLower} ID: must be a positive integer`);
      }
      userId = parsed;
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        throw new ValidationError(`${roleLabel} name cannot be empty`);
      }
      const user = selectGroupMemberByName.get(groupId, trimmed) as { id: number; name: string } | undefined;
      if (!user) {
        throw new ValidationError(`${roleLabel} must be a member of the group`);
      }
      userId = user.id;
    } else if (typeof raw === 'object' && !Array.isArray(raw)) {
      const obj = raw as Record<string, unknown>;
      if (obj.id !== undefined && obj.id !== null) {
        const parsed = parseId(obj.id);
        if (parsed === null) {
          throw new ValidationError(`Invalid ${roleLower} ID: must be a positive integer`);
        }
        userId = parsed;
      } else if (obj.name !== undefined && obj.name !== null) {
        if (typeof obj.name !== 'string') {
          throw new ValidationError(`${roleLabel} name must be a string`);
        }
        const trimmed = obj.name.trim();
        if (!trimmed) {
          throw new ValidationError(`${roleLabel} name cannot be empty`);
        }
        const user = selectGroupMemberByName.get(groupId, trimmed) as { id: number; name: string } | undefined;
        if (!user) {
          throw new ValidationError(`${roleLabel} must be a member of the group`);
        }
        userId = user.id;
      } else {
        throw new ValidationError(`Invalid ${roleLower} format`);
      }
    } else {
      throw new ValidationError(`Invalid ${roleLower} format`);
    }

    // Check that participant is a member of this group
    const isMember = checkMembershipStmt.get(groupId, userId);
    if (!isMember) {
      throw new ValidationError(`${roleLabel} must be a member of the group`);
    }

    return userId;
  }

  function resolveAndCalculateSplits(
    groupId: number,
    amount: number,
    body: Record<string, unknown>,
    defaultMemberIds: number[]
  ): CalculatedSplit[] {
    const hasSplits = body.splits !== undefined;
    const hasShares = body.shares !== undefined;
    const hasRatios = body.ratios !== undefined;
    const hasPercentages = body.percentages !== undefined;
    const hasSplitAmounts = body.split_amounts !== undefined;

    const countProps =
      (hasSplits ? 1 : 0) +
      (hasShares ? 1 : 0) +
      (hasRatios ? 1 : 0) +
      (hasPercentages ? 1 : 0) +
      (hasSplitAmounts ? 1 : 0);

    if (countProps > 1) {
      throw new ValidationError('Ambiguous split specification: multiple split properties provided');
    }

    const rawSplitType = body.split_type;
    let splitType: string | undefined;
    if (rawSplitType !== undefined) {
      if (typeof rawSplitType !== 'string') {
        throw new ValidationError('split_type must be a string');
      }
      const lower = rawSplitType.trim().toLowerCase();
      const validTypes = [
        'equal',
        'exact',
        'amounts',
        'ratio',
        'ratios',
        'shares',
        'percentage',
        'percentages',
        'percent',
      ];
      if (!validTypes.includes(lower)) {
        throw new ValidationError(`Unsupported split_type: ${rawSplitType}`);
      }
      splitType = lower;
    }

    for (const key of DISALLOWED_TOP_LEVEL_SPLIT_KEYS) {
      if (body[key] !== undefined) {
        throw new ValidationError(`Unrecognized split property '${key}' at top level`);
      }
    }

    // Default equal split if no split specifications are present
    if (countProps === 0) {
      if (splitType !== undefined && splitType !== 'equal') {
        throw new ValidationError(`Splits definition is required for split type '${rawSplitType}'`);
      }
      if (defaultMemberIds.length === 0) {
        throw new ValidationError('Group has no members to split expense between');
      }
      return calculateEqualSplits(amount, defaultMemberIds);
    }

    let splitSource: unknown;
    let explicitMode: 'exact' | 'ratio' | 'percentage' | undefined;

    if (hasShares || hasRatios) {
      splitSource = hasShares ? body.shares : body.ratios;
      explicitMode = 'ratio';
      if (splitType && !['ratio', 'ratios', 'shares'].includes(splitType)) {
        throw new ValidationError(`Ambiguous split specification: split_type '${rawSplitType}' conflicts with shares/ratios`);
      }
    } else if (hasPercentages) {
      splitSource = body.percentages;
      explicitMode = 'percentage';
      if (splitType && !['percentage', 'percentages', 'percent'].includes(splitType)) {
        throw new ValidationError(`Ambiguous split specification: split_type '${rawSplitType}' conflicts with percentages`);
      }
    } else if (hasSplitAmounts) {
      splitSource = body.split_amounts;
      explicitMode = 'exact';
      if (splitType && !['exact', 'amounts'].includes(splitType)) {
        throw new ValidationError(`Ambiguous split specification: split_type '${rawSplitType}' conflicts with split_amounts`);
      }
    } else {
      splitSource = body.splits;
    }

    if (typeof splitSource !== 'object' || splitSource === null) {
      throw new ValidationError('Splits must be an array or object');
    }

    const seenUsers = new Set<number>();

    // Object format (mapping user key -> split value)
    if (!Array.isArray(splitSource)) {
      const entries = Object.entries(splitSource);
      if (entries.length === 0) {
        throw new ValidationError('Splits list cannot be empty');
      }

      if (splitType === 'equal') {
        throw new ValidationError('Invalid split specification: unexpected split values for equal split');
      }

      let mode = explicitMode;
      if (!mode) {
        if (splitType && ['ratio', 'ratios', 'shares'].includes(splitType)) {
          mode = 'ratio';
        } else if (splitType && ['percentage', 'percentages', 'percent'].includes(splitType)) {
          mode = 'percentage';
        } else {
          mode = 'exact';
        }
      }

      const exactItems: ExactSplitItem[] = [];
      const ratioItems: RatioSplitItem[] = [];
      const pctItems: PercentageSplitItem[] = [];

      for (const [key, val] of entries) {
        const parsedKeyId = parseId(key);
        const participantInput = parsedKeyId !== null ? { id: parsedKeyId } : { name: key };
        const userId = resolveGroupParticipant(participantInput, 'Participant', groupId);
        if (seenUsers.has(userId)) {
          throw new ValidationError('Duplicate participant in splits');
        }
        seenUsers.add(userId);

        if (mode === 'exact') {
          if (typeof val !== 'number' || !Number.isSafeInteger(val) || val <= 0) {
            throw new ValidationError('Split amount must be a positive integer in cents');
          }
          exactItems.push({ userId, amount: val });
        } else if (mode === 'ratio') {
          if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
            throw new ValidationError('Split ratio must be a positive number');
          }
          ratioItems.push({ userId, ratio: val });
        } else {
          // percentage
          if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
            throw new ValidationError('Split percentage must be positive');
          }
          pctItems.push({ userId, percentage: val });
        }
      }

      try {
        if (mode === 'exact') {
          return calculateExactSplits(amount, exactItems);
        } else if (mode === 'ratio') {
          return calculateRatioSplits(amount, ratioItems);
        } else {
          return calculatePercentageSplits(amount, pctItems);
        }
      } catch (err) {
        if (err instanceof BalanceEngineError) {
          throw new ValidationError(err.message);
        }
        throw err;
      }
    }

    // Array format
    const arr = splitSource as unknown[];
    if (arr.length === 0) {
      throw new ValidationError('Splits list cannot be empty');
    }

    // Check if items are primitive strings/numbers (equal split across subset of members)
    const isAllPrimitives = arr.every((item) => typeof item === 'string' || typeof item === 'number');
    if (isAllPrimitives) {
      if (explicitMode || (splitType && splitType !== 'equal')) {
        throw new ValidationError(`Expected split values for split type '${rawSplitType ?? explicitMode}'`);
      }
      const resolvedIds: number[] = [];
      for (const item of arr) {
        const userId = resolveGroupParticipant(item, 'Participant', groupId);
        if (seenUsers.has(userId)) {
          throw new ValidationError('Duplicate participant in splits');
        }
        seenUsers.add(userId);
        resolvedIds.push(userId);
      }
      return calculateEqualSplits(amount, resolvedIds);
    }

    let detectedType: 'exact' | 'ratio' | 'percentage' | 'equal' | undefined;
    const exactItems: ExactSplitItem[] = [];
    const ratioItems: RatioSplitItem[] = [];
    const pctItems: PercentageSplitItem[] = [];
    const equalMembers: number[] = [];

    for (const item of arr) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new ValidationError('Invalid split item: must be an object');
      }

      const rec = item as Record<string, unknown>;
      for (const key of Object.keys(rec)) {
        if (!ALLOWED_SPLIT_ITEM_KEYS.has(key)) {
          throw new ValidationError(`Unknown property '${key}' in split item`);
        }
      }
      const userId = resolveGroupParticipant(rec, 'Participant', groupId, SPLIT_PARTICIPANT_ALIASES);
      if (seenUsers.has(userId)) {
        throw new ValidationError('Duplicate participant in splits');
      }
      seenUsers.add(userId);

      const presentAmountKeys = ['amount', 'split_amount'].filter((k) => rec[k] !== undefined);
      const presentRatioKeys = ['ratio', 'shares', 'weight'].filter((k) => rec[k] !== undefined);
      const presentPctKeys = ['percentage', 'percent', 'pct'].filter((k) => rec[k] !== undefined);

      const totalValueProps =
        presentAmountKeys.length + presentRatioKeys.length + presentPctKeys.length;

      if (totalValueProps > 1) {
        throw new ValidationError('Ambiguous split specification in split item');
      }

      let currentItemType: 'exact' | 'ratio' | 'percentage' | 'equal';
      let rawAmt: unknown;
      let rawRatio: unknown;
      let rawPct: unknown;

      if (presentAmountKeys.length === 1) {
        currentItemType = 'exact';
        rawAmt = rec[presentAmountKeys[0]];
      } else if (presentRatioKeys.length === 1) {
        currentItemType = 'ratio';
        rawRatio = rec[presentRatioKeys[0]];
      } else if (presentPctKeys.length === 1) {
        currentItemType = 'percentage';
        rawPct = rec[presentPctKeys[0]];
      } else {
        currentItemType = 'equal';
      }

      if (detectedType === undefined) {
        detectedType = currentItemType;
      } else if (detectedType !== currentItemType) {
        throw new ValidationError('Mixed split specification: cannot mix amounts, ratios, and percentages');
      }

      // Check against explicitMode or splitType
      const activeMode =
        explicitMode ??
        (splitType === 'equal'
          ? 'equal'
          : ['exact', 'amounts'].includes(splitType ?? '')
            ? 'exact'
            : ['ratio', 'ratios', 'shares'].includes(splitType ?? '')
              ? 'ratio'
              : ['percentage', 'percentages', 'percent'].includes(splitType ?? '')
                ? 'percentage'
                : undefined);

      if (activeMode && activeMode !== currentItemType) {
        if (activeMode === 'exact') {
          throw new ValidationError('Invalid split specification: expected amounts for exact split');
        } else if (activeMode === 'ratio') {
          throw new ValidationError('Invalid split specification: expected ratios/shares');
        } else if (activeMode === 'percentage') {
          throw new ValidationError('Invalid split specification: expected percentages');
        } else if (activeMode === 'equal') {
          throw new ValidationError('Invalid split specification: unexpected split values for equal split');
        }
      }

      if (currentItemType === 'exact') {
        if (typeof rawAmt !== 'number' || !Number.isSafeInteger(rawAmt) || rawAmt <= 0) {
          throw new ValidationError('Split amount must be a positive integer in cents');
        }
        exactItems.push({ userId, amount: rawAmt });
      } else if (currentItemType === 'ratio') {
        if (typeof rawRatio !== 'number' || !Number.isFinite(rawRatio) || rawRatio <= 0) {
          throw new ValidationError('Split ratio must be a positive number');
        }
        ratioItems.push({ userId, ratio: rawRatio });
      } else if (currentItemType === 'percentage') {
        if (typeof rawPct !== 'number' || !Number.isFinite(rawPct) || rawPct <= 0) {
          throw new ValidationError('Split percentage must be positive');
        }
        pctItems.push({ userId, percentage: rawPct });
      } else {
        equalMembers.push(userId);
      }
    }

    try {
      if (detectedType === 'exact') {
        return calculateExactSplits(amount, exactItems);
      } else if (detectedType === 'ratio') {
        return calculateRatioSplits(amount, ratioItems);
      } else if (detectedType === 'percentage') {
        return calculatePercentageSplits(amount, pctItems);
      } else {
        return calculateEqualSplits(amount, equalMembers);
      }
    } catch (err) {
      if (err instanceof BalanceEngineError) {
        throw new ValidationError(err.message);
      }
      throw err;
    }
  }

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

  // POST /groups/:id/expenses - Add an expense with equal split among group members
  router.post('/:id/expenses', (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params.id;
      const groupId = parseId(rawId);
      if (groupId === null) {
        res.status(400).json({ error: 'Invalid group ID: must be a positive integer' });
        return;
      }

      const group = selectGroupById.get(groupId);
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const body = req.body ?? {};
      const amount = parseAmount(body.amount);
      const description = parseDescription(body.description);
      const date = parseDate(body.date);

      const payerUserId = resolveGroupParticipant(body, 'Payer', groupId, EXPENSE_PAYER_ALIASES);

      const memberRows = selectGroupMemberIds.all(groupId) as { user_id: number }[];
      const memberIds = memberRows.map((r) => r.user_id);

      const calculatedSplits = resolveAndCalculateSplits(groupId, amount, body, memberIds);
      const expense = createExpenseTransaction(groupId, payerUserId, amount, description, date, calculatedSplits);
      res.status(201).json(expense);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // GET /groups/:id/expenses - List all expenses for a group
  router.get('/:id/expenses', (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params.id;
      const groupId = parseId(rawId);
      if (groupId === null) {
        res.status(400).json({ error: 'Invalid group ID: must be a positive integer' });
        return;
      }

      const group = selectGroupById.get(groupId);
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const expenses = getGroupExpensesWithSplits(groupId);
      res.status(200).json(expenses);
    } catch (err) {
      next(err);
    }
  });

  // POST /groups/:id/settle - Record a debt repayment between two group members
  router.post('/:id/settle', (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params.id;
      const groupId = parseId(rawId);
      if (groupId === null) {
        res.status(400).json({ error: 'Invalid group ID: must be a positive integer' });
        return;
      }

      const group = selectGroupById.get(groupId);
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const body = req.body ?? {};
      const amount = parseAmount(body.amount);
      const description = parseDescription(body.description);
      const date = parseDate(body.date);

      const fromUserId = resolveGroupParticipant(body, 'Payer', groupId, SETTLE_FROM_ALIASES);
      const toUserId = resolveGroupParticipant(body, 'Payee', groupId, SETTLE_TO_ALIASES);

      // Member cannot settle with themselves
      if (fromUserId === toUserId) {
        res.status(400).json({ error: 'Cannot settle with self' });
        return;
      }

      let settlementId: number;
      if (date !== undefined) {
        const info = insertSettlementWithDateStmt.run(groupId, fromUserId, toUserId, amount, description, date);
        settlementId = Number(info.lastInsertRowid);
      } else {
        const info = insertSettlementStmt.run(groupId, fromUserId, toUserId, amount, description);
        settlementId = Number(info.lastInsertRowid);
      }

      const created = selectSettlementById.get(settlementId) as {
        id: number;
        group_id: number;
        from_user_id: number;
        to_user_id: number;
        amount: number;
        description: string;
        date: string;
        created_at: string;
        from_name: string;
        to_name: string;
      };

      const result: Settlement = {
        id: created.id,
        group_id: created.group_id,
        from: created.from_user_id,
        to: created.to_user_id,
        from_user_id: created.from_user_id,
        to_user_id: created.to_user_id,
        from_name: created.from_name,
        to_name: created.to_name,
        amount: created.amount,
        description: created.description,
        date: created.date,
        created_at: created.created_at,
      };

      res.status(201).json(result);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // Handler for listing settlements
  const handleListSettlements = (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params.id;
      const groupId = parseId(rawId);
      if (groupId === null) {
        res.status(400).json({ error: 'Invalid group ID: must be a positive integer' });
        return;
      }

      const group = selectGroupById.get(groupId);
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const rows = selectSettlementsByGroupId.all(groupId) as {
        id: number;
        group_id: number;
        from_user_id: number;
        to_user_id: number;
        amount: number;
        description: string;
        date: string;
        created_at: string;
        from_name: string;
        to_name: string;
      }[];

      const members = selectGroupMembers.all(groupId) as Member[];
      const memberIdSet = new Set(members.map((m) => m.id));
      for (const r of rows) {
        if (!memberIdSet.has(r.from_user_id) || !memberIdSet.has(r.to_user_id)) {
          throw new BalanceEngineError(
            `Corrupt settlement ${r.id}: participant is not a member of group ${groupId}`,
            'INVALID_USER_ID'
          );
        }
      }

      const settlements: Settlement[] = rows.map((r) => ({
        id: r.id,
        group_id: r.group_id,
        from: r.from_user_id,
        to: r.to_user_id,
        from_user_id: r.from_user_id,
        to_user_id: r.to_user_id,
        from_name: r.from_name,
        to_name: r.to_name,
        amount: r.amount,
        description: r.description,
        date: r.date,
        created_at: r.created_at,
      }));

      res.status(200).json(settlements);
    } catch (err) {
      next(err);
    }
  };

  // GET /groups/:id/settlements - List recorded settlements for a group
  router.get('/:id/settlements', handleListSettlements);

  // GET /groups/:id/balances - Get group balance summary
  router.get('/:id/balances', (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params.id;
      const groupId = parseId(rawId);
      if (groupId === null) {
        res.status(400).json({ error: 'Invalid group ID: must be a positive integer' });
        return;
      }

      const group = selectGroupById.get(groupId);
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const members = selectGroupMembers.all(groupId) as Member[];
      const fullExpenses = getGroupExpensesWithSplits(groupId);
      const settlements = selectSettlementsByGroupId.all(groupId) as {
        id: number;
        group_id: number;
        from_user_id: number;
        to_user_id: number;
        amount: number;
        description: string;
        date: string;
        created_at: string;
        from_name: string;
        to_name: string;
      }[];

      const memberIdSet = new Set(members.map((m) => m.id));
      for (const s of settlements) {
        if (!memberIdSet.has(s.from_user_id) || !memberIdSet.has(s.to_user_id)) {
          throw new BalanceEngineError(
            `Corrupt settlement ${s.id}: participant is not a member of group ${groupId}`,
            'INVALID_USER_ID'
          );
        }
      }

      const settlementInputs: SettlementInput[] = settlements.map((s) => ({
        id: s.id,
        group_id: s.group_id,
        from: s.from_user_id,
        to: s.to_user_id,
        from_user_id: s.from_user_id,
        to_user_id: s.to_user_id,
        amount: s.amount,
      }));

      const summary = calculateBalances(fullExpenses, {
        members,
        settlements: settlementInputs,
      });
      res.status(200).json(summary);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
