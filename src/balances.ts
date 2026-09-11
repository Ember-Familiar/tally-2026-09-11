/**
 * Pure, reusable balance calculation engine and deterministic debt simplification for Tally.
 *
 * Arithmetic principles:
 * - All currency amounts are strictly non-negative or positive safe integers representing cents.
 * - Net balances are strictly safe integers representing cents (positive = owed money, negative = owes money).
 * - Zero floating-point arithmetic is used for currency balances.
 * - Conservation invariant: for every expense with splits, sum(splits) === expense.amount.
 *   If torn splits occur (e.g. from direct SQLite CASCADE deletions where sum(splits) < expense.amount),
 *   or malformed splits occur, BalanceEngineError is thrown to prevent silent manufacturing or losing of cents.
 */

export type BalanceEngineErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_AMOUNT'
  | 'INVALID_USER_ID'
  | 'INCONSISTENT_SPLITS'
  | 'CONSERVATION_VIOLATION'
  | 'DUPLICATE_SPLIT_USER'
  | 'DUPLICATE_USER'
  | 'INTEGER_OVERFLOW';

export class BalanceEngineError extends Error {
  readonly code: BalanceEngineErrorCode;

  constructor(message: string, code: BalanceEngineErrorCode) {
    super(message);
    this.name = 'BalanceEngineError';
    this.code = code;
    Object.setPrototypeOf(this, BalanceEngineError.prototype);
  }
}

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Adds two safe integer numbers with overflow checking.
 * Throws BalanceEngineError('INVALID_AMOUNT') if an argument is not a safe integer.
 * Throws BalanceEngineError('INTEGER_OVERFLOW') if the mathematical sum exceeds the safe integer range.
 */
export function checkedAdd(a: number, b: number, context?: string): number {
  if (typeof a !== 'number' || !Number.isSafeInteger(a)) {
    throw new BalanceEngineError(
      `First argument to checkedAdd must be a safe integer${context ? ` (${context})` : ''}, got ${a}`,
      'INVALID_AMOUNT'
    );
  }
  if (typeof b !== 'number' || !Number.isSafeInteger(b)) {
    throw new BalanceEngineError(
      `Second argument to checkedAdd must be a safe integer${context ? ` (${context})` : ''}, got ${b}`,
      'INVALID_AMOUNT'
    );
  }
  const sum = BigInt(a) + BigInt(b);
  if (sum > MAX_SAFE_INTEGER_BIGINT || sum < MIN_SAFE_INTEGER_BIGINT) {
    throw new BalanceEngineError(
      `Integer overflow in addition${context ? ` (${context})` : ''}: ${a} + ${b} exceeds safe integer range`,
      'INTEGER_OVERFLOW'
    );
  }
  return Number(sum);
}

/**
 * Subtracts two safe integer numbers with overflow checking.
 * Throws BalanceEngineError('INVALID_AMOUNT') if an argument is not a safe integer.
 * Throws BalanceEngineError('INTEGER_OVERFLOW') if the mathematical difference exceeds the safe integer range.
 */
export function checkedSub(a: number, b: number, context?: string): number {
  if (typeof a !== 'number' || !Number.isSafeInteger(a)) {
    throw new BalanceEngineError(
      `First argument to checkedSub must be a safe integer${context ? ` (${context})` : ''}, got ${a}`,
      'INVALID_AMOUNT'
    );
  }
  if (typeof b !== 'number' || !Number.isSafeInteger(b)) {
    throw new BalanceEngineError(
      `Second argument to checkedSub must be a safe integer${context ? ` (${context})` : ''}, got ${b}`,
      'INVALID_AMOUNT'
    );
  }
  const diff = BigInt(a) - BigInt(b);
  if (diff > MAX_SAFE_INTEGER_BIGINT || diff < MIN_SAFE_INTEGER_BIGINT) {
    throw new BalanceEngineError(
      `Integer overflow in subtraction${context ? ` (${context})` : ''}: ${a} - ${b} exceeds safe integer range`,
      'INTEGER_OVERFLOW'
    );
  }
  return Number(diff);
}

export interface MemberInput {
  id?: number;
  user_id?: number;
  userId?: number;
  name?: string | null;
}

export interface CalculatedSplit {
  userId: number;
  amount: number;
  name?: string | null;
}

export interface RatioSplitItem {
  user_id?: number;
  userId?: number;
  ratio?: number;
  shares?: number;
  weight?: number;
  name?: string | null;
}

export interface PercentageSplitItem {
  user_id?: number;
  userId?: number;
  percentage?: number;
  percent?: number;
  pct?: number;
  name?: string | null;
}

export interface ExactSplitItem {
  user_id?: number;
  userId?: number;
  amount: number;
  name?: string | null;
}

export interface ExpenseSplitInput {
  id?: number;
  expense_id?: number;
  user_id?: number;
  userId?: number;
  user_name?: string | null;
  name?: string | null;
  amount?: number;
  ratio?: number;
  shares?: number;
  weight?: number;
  percentage?: number;
  percent?: number;
  pct?: number;
  created_at?: string;
}

export interface ExpenseInput {
  id?: number;
  group_id?: number;
  paid_by?: number;
  payer_id?: number;
  amount: number;
  description?: string;
  date?: string;
  created_at?: string;
  splits?: ExpenseSplitInput[] | Record<string | number, number>;
  shares?: Record<string | number, number> | RatioSplitItem[];
  ratios?: Record<string | number, number> | RatioSplitItem[];
  percentages?: Record<string | number, number> | PercentageSplitItem[];
}

export interface SettlementInput {
  id?: number;
  group_id?: number;
  from?: number;
  from_user_id?: number;
  paid_by?: number;
  payer_id?: number;
  to?: number;
  to_user_id?: number;
  payee_id?: number;
  received_by?: number;
  amount: number;
}

export interface BalanceOptions {
  members?: Array<number | MemberInput>;
  splits?: Array<ExpenseSplitInput & { expense_id?: number }>;
  settlements?: SettlementInput[];
}

export interface UserBalance {
  user_id: number;
  userId: number;
  name: string | null;
  paid: number;
  owed: number;
  net_balance: number;
  balance: number;
}

export type UserBalanceInput =
  | UserBalance
  | {
      user_id?: number | string;
      userId?: number | string;
      name?: string | null;
      paid?: number;
      owed?: number;
      net_balance?: number;
      balance?: number;
    };

export interface Transfer {
  from: number;
  to: number;
  from_user_id: number;
  to_user_id: number;
  from_name?: string;
  to_name?: string;
  amount: number;
}

export type PairwiseDebt = Transfer;

export interface GroupBalanceSummary {
  balances: UserBalance[];
  net_balances: Record<number, number>;
  settlements: Transfer[];
  pairwise: Transfer[];
  total_spend: number;
}

interface InternalUserState {
  userId: number;
  name: string | null;
  paid: number;
  owed: number;
}

/**
 * Normalizes a user ID into a positive integer.
 * Throws BalanceEngineError if the input is not a valid positive safe integer.
 */
export function normalizeUserId(raw: unknown): number {
  if (typeof raw === 'number') {
    if (Number.isSafeInteger(raw) && raw > 0) {
      return raw;
    }
    throw new BalanceEngineError(
      `Invalid user ID: must be a positive integer, got ${raw}`,
      'INVALID_USER_ID'
    );
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isSafeInteger(num) && num > 0) {
        return num;
      }
    }
    throw new BalanceEngineError(
      `Invalid user ID: must be a positive integer, got "${raw}"`,
      'INVALID_USER_ID'
    );
  }
  throw new BalanceEngineError(
    `Invalid user ID: must be a positive integer, got ${String(raw)}`,
    'INVALID_USER_ID'
  );
}

/**
 * Validates that an expense amount is a positive safe integer in cents.
 */
export function validateExpenseAmount(amount: unknown): number {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new BalanceEngineError(
      `Expense amount must be a positive integer in cents, got ${amount}`,
      'INVALID_AMOUNT'
    );
  }
  return amount;
}

/**
 * Validates that a split amount is a non-negative safe integer in cents.
 */
export function validateSplitAmount(amount: unknown): number {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
    throw new BalanceEngineError(
      `Split amount must be a non-negative integer in cents, got ${amount}`,
      'INVALID_AMOUNT'
    );
  }
  return amount;
}

/**
 * Validates that a settlement amount is a positive safe integer in cents.
 */
export function validateSettlementAmount(amount: unknown): number {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new BalanceEngineError(
      `Settlement amount must be a positive integer in cents, got ${amount}`,
      'INVALID_AMOUNT'
    );
  }
  return amount;
}

/**
 * Distribute an amount evenly across member IDs in cents with integer remainder distribution.
 */
function distributeEqualSplits(totalAmount: number, memberUserIds: number[]): ExpenseSplitInput[] {
  if (memberUserIds.length === 0) {
    throw new BalanceEngineError('Cannot distribute split among empty members', 'INVALID_INPUT');
  }
  const n = memberUserIds.length;
  const base = Math.floor(totalAmount / n);
  const remainder = totalAmount % n;
  const sortedIds = [...memberUserIds].sort((a, b) => a - b);

  return sortedIds.map((userId, index) => ({
    userId,
    user_id: userId,
    amount: base + (index < remainder ? 1 : 0),
  }));
}

/**
 * Validates and calculates custom exact split amounts in integer cents.
 * Asserts sum(splits) === totalAmount.
 */
export function calculateExactSplits(
  totalAmount: number,
  splits: ExactSplitItem[]
): CalculatedSplit[] {
  const validTotal = validateExpenseAmount(totalAmount);
  if (!Array.isArray(splits) || splits.length === 0) {
    throw new BalanceEngineError('Splits list cannot be empty', 'INVALID_INPUT');
  }

  const seenUsers = new Set<number>();
  let sum = 0;
  const results: CalculatedSplit[] = [];

  for (const s of splits) {
    if (!s || typeof s !== 'object') {
      throw new BalanceEngineError('Invalid split item: must be an object', 'INVALID_INPUT');
    }
    const rawId = s.user_id ?? s.userId;
    const userId = normalizeUserId(rawId);
    if (seenUsers.has(userId)) {
      throw new BalanceEngineError(`Duplicate split for user ${userId}`, 'DUPLICATE_SPLIT_USER');
    }
    seenUsers.add(userId);

    const amt = s.amount;
    if (typeof amt !== 'number' || !Number.isSafeInteger(amt) || amt <= 0) {
      throw new BalanceEngineError('Split amount must be a positive integer in cents', 'INVALID_AMOUNT');
    }

    sum = checkedAdd(sum, amt, 'exact split sum');
    results.push({ userId, amount: amt, name: s.name ?? null });
  }

  if (sum !== validTotal) {
    throw new BalanceEngineError(
      `Split amounts sum (${sum}) does not equal total amount (${validTotal})`,
      'INCONSISTENT_SPLITS'
    );
  }

  results.sort((a, b) => a.userId - b.userId);
  return results;
}

/**
 * Distributes totalAmount across members according to ratios/shares using largest remainder method.
 * Remainder cents are allocated to members with largest fractional remainder; ties broken by userId ASC.
 */
export function calculateRatioSplits(
  totalAmount: number,
  ratios: RatioSplitItem[]
): CalculatedSplit[] {
  const validTotal = validateExpenseAmount(totalAmount);
  if (!Array.isArray(ratios) || ratios.length === 0) {
    throw new BalanceEngineError('Splits list cannot be empty', 'INVALID_INPUT');
  }

  const seenUsers = new Set<number>();
  const parsedItems: Array<{ userId: number; weight: number; name?: string | null }> = [];

  for (const item of ratios) {
    if (!item || typeof item !== 'object') {
      throw new BalanceEngineError('Invalid ratio split item: must be an object', 'INVALID_INPUT');
    }
    const rawId = item.user_id ?? item.userId;
    const userId = normalizeUserId(rawId);
    if (seenUsers.has(userId)) {
      throw new BalanceEngineError(`Duplicate split for user ${userId}`, 'DUPLICATE_SPLIT_USER');
    }
    seenUsers.add(userId);

    const presentWeightKeys = (['ratio', 'shares', 'weight'] as const).filter(
      (k) => item[k] !== undefined
    );
    if (presentWeightKeys.length > 1) {
      throw new BalanceEngineError(
        'Ambiguous split ratio item: multiple weight properties provided',
        'INVALID_INPUT'
      );
    }
    const rawWeight = presentWeightKeys.length === 1 ? item[presentWeightKeys[0]] : undefined;
    if (typeof rawWeight !== 'number' || !Number.isFinite(rawWeight) || rawWeight <= 0) {
      throw new BalanceEngineError('Split ratio must be a positive number', 'INVALID_INPUT');
    }
    parsedItems.push({ userId, weight: rawWeight, name: item.name ?? null });
  }

  let maxDecimals = 0;
  for (const item of parsedItems) {
    const s = item.weight.toString();
    const dotIdx = s.indexOf('.');
    if (dotIdx !== -1) {
      const decLen = s.length - dotIdx - 1;
      if (decLen > maxDecimals) maxDecimals = decLen;
    }
  }
  if (maxDecimals > 6) maxDecimals = 6;
  const scale = 10 ** maxDecimals;

  let totalWeight = 0n;
  const bigItems = parsedItems.map((p) => {
    const scaled = p.weight * scale;
    if (!Number.isFinite(scaled) || !Number.isFinite(Math.round(scaled))) {
      throw new BalanceEngineError('Split ratio exceeds maximum allowable value', 'INVALID_INPUT');
    }
    const w = BigInt(Math.round(scaled));
    if (w <= 0n) {
      throw new BalanceEngineError('Split ratio must be a positive number', 'INVALID_INPUT');
    }
    totalWeight += w;
    return { userId: p.userId, weight: w, name: p.name };
  });

  if (totalWeight <= 0n) {
    throw new BalanceEngineError('Total ratio must be positive', 'INVALID_INPUT');
  }

  const bigTotal = BigInt(validTotal);
  let baseSum = 0;
  const allocations = bigItems.map((item, index) => {
    const numerator = item.weight * bigTotal;
    const base = Number(numerator / totalWeight);
    const rem = numerator % totalWeight;
    baseSum = checkedAdd(baseSum, base, 'ratio base sum');
    return {
      userId: item.userId,
      base,
      rem,
      index,
      name: item.name,
    };
  });

  const remainderCents = validTotal - baseSum;
  allocations.sort((a, b) => {
    if (b.rem !== a.rem) {
      return b.rem > a.rem ? 1 : -1;
    }
    return a.userId - b.userId;
  });

  for (let i = 0; i < remainderCents; i++) {
    allocations[i].base += 1;
  }

  const results: CalculatedSplit[] = allocations.map((a) => ({
    userId: a.userId,
    amount: a.base,
    name: a.name ?? null,
  }));

  results.sort((a, b) => a.userId - b.userId);
  return results;
}

/**
 * Distributes totalAmount across members according to percentages using largest remainder method.
 * Percentages must sum to 100.
 * Remainder cents are allocated to members with largest fractional remainder; ties broken by userId ASC.
 */
export function calculatePercentageSplits(
  totalAmount: number,
  percentages: PercentageSplitItem[]
): CalculatedSplit[] {
  const validTotal = validateExpenseAmount(totalAmount);
  if (!Array.isArray(percentages) || percentages.length === 0) {
    throw new BalanceEngineError('Splits list cannot be empty', 'INVALID_INPUT');
  }

  const seenUsers = new Set<number>();
  const parsedItems: Array<{ userId: number; percentage: number; name?: string | null }> = [];
  let rawSum = 0;

  for (const item of percentages) {
    if (!item || typeof item !== 'object') {
      throw new BalanceEngineError('Invalid percentage split item: must be an object', 'INVALID_INPUT');
    }
    const rawId = item.user_id ?? item.userId;
    const userId = normalizeUserId(rawId);
    if (seenUsers.has(userId)) {
      throw new BalanceEngineError(`Duplicate split for user ${userId}`, 'DUPLICATE_SPLIT_USER');
    }
    seenUsers.add(userId);

    const presentPctKeys = (['percentage', 'percent', 'pct'] as const).filter(
      (k) => item[k] !== undefined
    );
    if (presentPctKeys.length > 1) {
      throw new BalanceEngineError(
        'Ambiguous split percentage item: multiple percentage properties provided',
        'INVALID_INPUT'
      );
    }
    const rawPct = presentPctKeys.length === 1 ? item[presentPctKeys[0]] : undefined;
    if (typeof rawPct !== 'number' || !Number.isFinite(rawPct) || rawPct <= 0) {
      throw new BalanceEngineError('Split percentage must be positive', 'INVALID_INPUT');
    }
    rawSum += rawPct;
    parsedItems.push({ userId, percentage: rawPct, name: item.name ?? null });
  }

  if (Math.abs(rawSum - 100) > 1e-5) {
    throw new BalanceEngineError('Split percentages must sum to 100', 'INVALID_INPUT');
  }

  let maxDecimals = 0;
  for (const item of parsedItems) {
    const s = item.percentage.toString();
    const dotIdx = s.indexOf('.');
    if (dotIdx !== -1) {
      const decLen = s.length - dotIdx - 1;
      if (decLen > maxDecimals) maxDecimals = decLen;
    }
  }
  if (maxDecimals > 6) maxDecimals = 6;
  const scale = 10 ** maxDecimals;

  let totalWeight = 0n;
  const bigItems = parsedItems.map((p) => {
    const scaled = p.percentage * scale;
    if (!Number.isFinite(scaled) || !Number.isFinite(Math.round(scaled))) {
      throw new BalanceEngineError('Split percentage exceeds maximum allowable value', 'INVALID_INPUT');
    }
    const w = BigInt(Math.round(scaled));
    if (w <= 0n) {
      throw new BalanceEngineError('Split percentage must be positive', 'INVALID_INPUT');
    }
    totalWeight += w;
    return { userId: p.userId, weight: w, name: p.name };
  });

  const bigTotal = BigInt(validTotal);
  let baseSum = 0;
  const allocations = bigItems.map((item, index) => {
    const numerator = item.weight * bigTotal;
    const base = Number(numerator / totalWeight);
    const rem = numerator % totalWeight;
    baseSum = checkedAdd(baseSum, base, 'percentage base sum');
    return {
      userId: item.userId,
      base,
      rem,
      index,
      name: item.name,
    };
  });

  const remainderCents = validTotal - baseSum;
  allocations.sort((a, b) => {
    if (b.rem !== a.rem) {
      return b.rem > a.rem ? 1 : -1;
    }
    return a.userId - b.userId;
  });

  for (let i = 0; i < remainderCents; i++) {
    allocations[i].base += 1;
  }

  const results: CalculatedSplit[] = allocations.map((a) => ({
    userId: a.userId,
    amount: a.base,
    name: a.name ?? null,
  }));

  results.sort((a, b) => a.userId - b.userId);
  return results;
}

/**
 * Resolves splits for an engine expense across splits array, shares/ratios, percentages, or member list.
 */
function resolveEngineExpenseSplits(
  exp: ExpenseInput,
  amount: number,
  memberIdsList: number[],
  separateSplitsByExpenseId: Map<number, ExpenseSplitInput[]>,
  memberNameToIdMap?: Map<string, number>
): ExpenseSplitInput[] {
  function resolveId(raw: unknown): number {
    if (typeof raw === 'string' && memberNameToIdMap) {
      const trimmed = raw.trim().toLowerCase();
      const matched = memberNameToIdMap.get(trimmed);
      if (matched !== undefined) {
        return matched;
      }
    }
    return normalizeUserId(raw);
  }

  if (Array.isArray(exp.splits) && exp.splits.length > 0) {
    for (const s of exp.splits) {
      if (!s || typeof s !== 'object') {
        return exp.splits;
      }
    }

    let hasRatio = false;
    let hasPct = false;
    let hasAmount = false;
    for (const s of exp.splits) {
      const anyS = s as Record<string, unknown>;
      if (anyS.ratio !== undefined || anyS.shares !== undefined || anyS.weight !== undefined) {
        hasRatio = true;
      }
      if (anyS.percentage !== undefined || anyS.percent !== undefined || anyS.pct !== undefined) {
        hasPct = true;
      }
      if (anyS.amount !== undefined) {
        hasAmount = true;
      }
    }

    if (hasRatio && (hasPct || hasAmount)) {
      throw new BalanceEngineError(
        'Mixed split specification: cannot mix amounts, ratios, and percentages',
        'INVALID_INPUT'
      );
    }
    if (hasPct && hasAmount) {
      throw new BalanceEngineError(
        'Mixed split specification: cannot mix amounts, ratios, and percentages',
        'INVALID_INPUT'
      );
    }

    if (hasRatio) {
      const ratioItems: RatioSplitItem[] = exp.splits.map((s) => {
        const anyS = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
        return {
          userId: resolveId(anyS.user_id ?? anyS.userId ?? anyS.id ?? anyS.name),
          ratio: (anyS.ratio ?? anyS.shares ?? anyS.weight) as number,
          name: (anyS.name ?? anyS.user_name) as string | null,
        };
      });
      const calculated = calculateRatioSplits(amount, ratioItems);
      return calculated.map((c) => ({
        userId: c.userId,
        user_id: c.userId,
        amount: c.amount,
        name: c.name,
      }));
    }
    if (hasPct) {
      const pctItems: PercentageSplitItem[] = exp.splits.map((s) => {
        const anyS = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
        return {
          userId: resolveId(anyS.user_id ?? anyS.userId ?? anyS.id ?? anyS.name),
          percentage: (anyS.percentage ?? anyS.percent ?? anyS.pct) as number,
          name: (anyS.name ?? anyS.user_name) as string | null,
        };
      });
      const calculated = calculatePercentageSplits(amount, pctItems);
      return calculated.map((c) => ({
        userId: c.userId,
        user_id: c.userId,
        amount: c.amount,
        name: c.name,
      }));
    }
    if (hasAmount) {
      return exp.splits;
    }
    return distributeEqualSplits(
      amount,
      exp.splits.map((s) =>
        resolveId(
          s.user_id ?? s.userId ?? (s as Record<string, unknown>).id ?? (s as Record<string, unknown>).name
        )
      )
    );
  }

  if (exp.splits && typeof exp.splits === 'object' && !Array.isArray(exp.splits)) {
    const exactItems: ExactSplitItem[] = Object.entries(exp.splits).map(([key, val]) => ({
      userId: resolveId(key),
      amount: val as number,
    }));
    const calculated = calculateExactSplits(amount, exactItems);
    return calculated.map((c) => ({
      userId: c.userId,
      user_id: c.userId,
      amount: c.amount,
      name: c.name,
    }));
  }

  if (exp.shares || exp.ratios) {
    const raw = exp.shares ?? exp.ratios;
    let ratioItems: RatioSplitItem[];
    if (Array.isArray(raw)) {
      ratioItems = raw.map((r) => {
        const anyR = r as Record<string, unknown>;
        return {
          userId: resolveId(anyR.user_id ?? anyR.userId ?? anyR.id ?? anyR.name),
          ratio: (anyR.ratio ?? anyR.shares ?? anyR.weight) as number,
          name: (anyR.name ?? anyR.user_name) as string | null,
        };
      });
    } else {
      ratioItems = Object.entries(raw as Record<string, number>).map(([key, val]) => ({
        userId: resolveId(key),
        ratio: val,
      }));
    }
    const calculated = calculateRatioSplits(amount, ratioItems);
    return calculated.map((c) => ({
      userId: c.userId,
      user_id: c.userId,
      amount: c.amount,
      name: c.name,
    }));
  }

  if (exp.percentages) {
    let pctItems: PercentageSplitItem[];
    if (Array.isArray(exp.percentages)) {
      pctItems = exp.percentages.map((p) => {
        const anyP = p as Record<string, unknown>;
        return {
          userId: resolveId(anyP.user_id ?? anyP.userId ?? anyP.id ?? anyP.name),
          percentage: (anyP.percentage ?? anyP.percent ?? anyP.pct) as number,
          name: (anyP.name ?? anyP.user_name) as string | null,
        };
      });
    } else {
      pctItems = Object.entries(exp.percentages as Record<string, number>).map(([key, val]) => ({
        userId: resolveId(key),
        percentage: val,
      }));
    }
    const calculated = calculatePercentageSplits(amount, pctItems);
    return calculated.map((c) => ({
      userId: c.userId,
      user_id: c.userId,
      amount: c.amount,
      name: c.name,
    }));
  }

  if (exp.id !== undefined && separateSplitsByExpenseId.has(exp.id)) {
    return separateSplitsByExpenseId.get(exp.id)!;
  }

  if (memberIdsList.length > 0) {
    return distributeEqualSplits(amount, memberIdsList);
  }

  throw new BalanceEngineError(
    `Expense ${exp.id ?? '(unidentified)'} has no splits and no group members were provided to compute splits`,
    'INCONSISTENT_SPLITS'
  );
}

/**
 * Process expenses, splits, and settlements into internal user balance states.
 */
function processTransactions(
  expenses: ExpenseInput[] = [],
  options: BalanceOptions = {}
): Map<number, InternalUserState> {
  if (!Array.isArray(expenses)) {
    throw new BalanceEngineError('Expenses must be an array', 'INVALID_INPUT');
  }

  const userMap = new Map<number, InternalUserState>();

  function ensureUser(userId: number, name?: string | null): InternalUserState {
    let user = userMap.get(userId);
    if (!user) {
      user = {
        userId,
        name: name ?? null,
        paid: 0,
        owed: 0,
      };
      userMap.set(userId, user);
    } else if (name && !user.name) {
      user.name = name;
    }
    return user;
  }

  // Register optional members
  const memberIdsList: number[] = [];
  const memberNameToIdMap = new Map<string, number>();
  if (options.members !== undefined) {
    if (!Array.isArray(options.members)) {
      throw new BalanceEngineError('Options members must be an array', 'INVALID_INPUT');
    }
    for (const m of options.members) {
      if (m !== null && typeof m === 'object') {
        const rawId = m.id ?? m.user_id ?? m.userId;
        const uId = normalizeUserId(rawId);
        ensureUser(uId, m.name);
        memberIdsList.push(uId);
        if (m.name) {
          memberNameToIdMap.set(m.name.trim().toLowerCase(), uId);
        }
      } else {
        const uId = normalizeUserId(m);
        ensureUser(uId);
        memberIdsList.push(uId);
      }
    }
  }

  // Index separate splits by expense_id if provided
  const separateSplitsByExpenseId = new Map<number, ExpenseSplitInput[]>();
  if (options.splits !== undefined) {
    if (!Array.isArray(options.splits)) {
      throw new BalanceEngineError('Options splits must be an array', 'INVALID_INPUT');
    }
    for (const s of options.splits) {
      if (s && s.expense_id !== undefined) {
        const expId = Number(s.expense_id);
        if (!separateSplitsByExpenseId.has(expId)) {
          separateSplitsByExpenseId.set(expId, []);
        }
        separateSplitsByExpenseId.get(expId)!.push(s);
      }
    }
  }

  // 1. Process expenses
  for (const exp of expenses) {
    if (!exp || typeof exp !== 'object') {
      throw new BalanceEngineError('Invalid expense: must be an object', 'INVALID_INPUT');
    }

    const payerId = normalizeUserId(exp.paid_by ?? exp.payer_id);
    const amount = validateExpenseAmount(exp.amount);

    const payer = ensureUser(payerId);
    payer.paid = checkedAdd(payer.paid, amount, `paid amount for user ${payerId}`);

    // Resolve splits
    const splits = resolveEngineExpenseSplits(
      exp,
      amount,
      memberIdsList,
      separateSplitsByExpenseId,
      memberNameToIdMap
    );

    if (splits.length === 0) {
      throw new BalanceEngineError(
        `Expense ${exp.id ?? '(unidentified)'} has empty splits`,
        'INCONSISTENT_SPLITS'
      );
    }

    // Validate splits and check conservation
    const seenSplitUsers = new Set<number>();
    let splitSum = 0n;

    for (const split of splits) {
      if (!split || typeof split !== 'object') {
        throw new BalanceEngineError('Invalid split: must be an object', 'INVALID_INPUT');
      }

      const splitUserId = normalizeUserId(split.user_id ?? split.userId);
      if (seenSplitUsers.has(splitUserId)) {
        throw new BalanceEngineError(
          `Duplicate split for user ${splitUserId} in expense ${exp.id ?? '(unidentified)'}`,
          'DUPLICATE_SPLIT_USER'
        );
      }
      seenSplitUsers.add(splitUserId);

      const splitAmount = validateSplitAmount(split.amount);
      splitSum += BigInt(splitAmount);

      const debtor = ensureUser(splitUserId, split.user_name ?? split.name);
      debtor.owed = checkedAdd(debtor.owed, splitAmount, `owed amount for user ${splitUserId}`);
    }

    if (splitSum !== BigInt(amount)) {
      throw new BalanceEngineError(
        `Expense ${exp.id ?? '(unidentified)'} amount (${amount}) does not equal sum of splits (${splitSum.toString()}). Conservation invariant violated.`,
        'INCONSISTENT_SPLITS'
      );
    }
  }

  // 2. Process settlements if provided
  if (options.settlements !== undefined) {
    if (!Array.isArray(options.settlements)) {
      throw new BalanceEngineError('Options settlements must be an array', 'INVALID_INPUT');
    }
    for (const s of options.settlements) {
      if (!s || typeof s !== 'object') {
        throw new BalanceEngineError('Invalid settlement: must be an object', 'INVALID_INPUT');
      }

      const fromId = normalizeUserId(s.from ?? s.from_user_id ?? s.paid_by ?? s.payer_id);
      const toId = normalizeUserId(s.to ?? s.to_user_id ?? s.payee_id ?? s.received_by);
      if (fromId === toId) {
        throw new BalanceEngineError(
          'Settlement from and to user cannot be the same user',
          'INVALID_INPUT'
        );
      }

      const settlementAmount = validateSettlementAmount(s.amount);

      const fromUser = ensureUser(fromId);
      fromUser.paid = checkedAdd(fromUser.paid, settlementAmount, `settlement paid amount for user ${fromId}`);

      const toUser = ensureUser(toId);
      toUser.owed = checkedAdd(toUser.owed, settlementAmount, `settlement owed amount for user ${toId}`);
    }
  }

  return userMap;
}

/**
 * Calculates detailed user balance records for each user involved in expenses or listed in members.
 * Amounts are strictly integer cents. Returns records sorted by user_id ASC.
 */
export function calculateUserBalances(
  expenses: ExpenseInput[] = [],
  options: BalanceOptions = {}
): UserBalance[] {
  const userMap = processTransactions(expenses, options);
  const records: UserBalance[] = [];

  for (const user of userMap.values()) {
    const netCents = checkedSub(user.paid, user.owed, `net balance for user ${user.userId}`);
    records.push({
      user_id: user.userId,
      userId: user.userId,
      name: user.name || null,
      paid: user.paid,
      owed: user.owed,
      net_balance: netCents,
      balance: netCents,
    });
  }

  records.sort((a, b) => a.user_id - b.user_id);
  return records;
}

/**
 * Calculates net balance in integer cents for each user (user_id -> net_cents).
 * Positive = user is owed money (creditor).
 * Negative = user owes money (debtor).
 */
export function calculateNetBalances(
  expenses: ExpenseInput[] = [],
  options: BalanceOptions = {}
): Record<number, number> {
  const userBalances = calculateUserBalances(expenses, options);
  const result: Record<number, number> = {};

  for (const u of userBalances) {
    result[u.user_id] = u.net_balance;
  }

  return result;
}

interface DebtorEntry {
  userId: number;
  name?: string;
  debtCents: number;
}

interface CreditorEntry {
  userId: number;
  name?: string;
  creditCents: number;
}

/**
 * Simplifies net debts using a deterministic greedy settlement algorithm.
 *
 * Guarantees:
 * 1. Exact conservation: sum of net balances must be 0, otherwise throws CONSERVATION_VIOLATION.
 * 2. Determinism: sorted by (amount DESC, userId ASC) so results are 100% reproducible.
 * 3. Transfer amounts are positive integers in cents.
 * 4. Every simplified transfer preserves the exact input net position of every user.
 * 5. Returns empty array for empty or already-settled inputs.
 */
export function simplifyDebts(
  netBalances:
    | UserBalanceInput[]
    | Record<number | string, number>
    | Map<number | string, number>
    | null
    | undefined
): Transfer[] {
  if (netBalances === null || netBalances === undefined) {
    return [];
  }

  const debtors: DebtorEntry[] = [];
  const creditors: CreditorEntry[] = [];
  let totalNet = 0n;

  if (Array.isArray(netBalances)) {
    const seenUsers = new Set<number>();
    for (const item of netBalances) {
      if (!item || typeof item !== 'object') continue;
      const uId = normalizeUserId(item.user_id ?? item.userId);
      if (seenUsers.has(uId)) {
        throw new BalanceEngineError(
          `Duplicate user ${uId} in net balances array`,
          'DUPLICATE_USER'
        );
      }
      seenUsers.add(uId);

      const bal = item.net_balance ?? item.balance;
      if (typeof bal !== 'number' || !Number.isSafeInteger(bal)) {
        throw new BalanceEngineError(
          `Net balance must be a safe integer in cents, got ${bal}`,
          'INVALID_AMOUNT'
        );
      }
      totalNet += BigInt(bal);
      if (bal < 0) {
        debtors.push({ userId: uId, name: item.name ?? undefined, debtCents: -bal });
      } else if (bal > 0) {
        creditors.push({ userId: uId, name: item.name ?? undefined, creditCents: bal });
      }
    }
  } else if (netBalances instanceof Map) {
    for (const [key, bal] of netBalances.entries()) {
      const uId = normalizeUserId(key);
      if (typeof bal !== 'number' || !Number.isSafeInteger(bal)) {
        throw new BalanceEngineError(
          `Net balance must be a safe integer in cents, got ${bal}`,
          'INVALID_AMOUNT'
        );
      }
      totalNet += BigInt(bal);
      if (bal < 0) {
        debtors.push({ userId: uId, debtCents: -bal });
      } else if (bal > 0) {
        creditors.push({ userId: uId, creditCents: bal });
      }
    }
  } else if (typeof netBalances === 'object') {
    for (const [key, bal] of Object.entries(netBalances)) {
      const uId = normalizeUserId(key);
      if (typeof bal !== 'number' || !Number.isSafeInteger(bal)) {
        throw new BalanceEngineError(
          `Net balance must be a safe integer in cents, got ${bal}`,
          'INVALID_AMOUNT'
        );
      }
      totalNet += BigInt(bal);
      if (bal < 0) {
        debtors.push({ userId: uId, debtCents: -bal });
      } else if (bal > 0) {
        creditors.push({ userId: uId, creditCents: bal });
      }
    }
  }

  // Conservation check
  if (totalNet !== 0n) {
    throw new BalanceEngineError(
      `Net balances do not sum to zero (sum = ${totalNet.toString()} cents). Conservation invariant violated.`,
      'CONSERVATION_VIOLATION'
    );
  }

  if (debtors.length === 0 || creditors.length === 0) {
    return [];
  }

  // Sort descending by amount, tie-breaker ascending by userId
  debtors.sort((a, b) => {
    if (b.debtCents !== a.debtCents) {
      return b.debtCents - a.debtCents;
    }
    return a.userId - b.userId;
  });

  creditors.sort((a, b) => {
    if (b.creditCents !== a.creditCents) {
      return b.creditCents - a.creditCents;
    }
    return a.userId - b.userId;
  });

  const transfers: Transfer[] = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    if (debtor.userId === creditor.userId) {
      throw new BalanceEngineError(
        `Self-transfer detected: debtor and creditor are both user ${debtor.userId}`,
        'CONSERVATION_VIOLATION'
      );
    }

    const settleCents = Math.min(debtor.debtCents, creditor.creditCents);
    if (settleCents > 0) {
      if (debtor.userId === creditor.userId) {
        throw new BalanceEngineError(
          `Self-transfer detected: debtor and creditor are both user ${debtor.userId}`,
          'CONSERVATION_VIOLATION'
        );
      }
      const transfer: Transfer = {
        from: debtor.userId,
        to: creditor.userId,
        from_user_id: debtor.userId,
        to_user_id: creditor.userId,
        amount: settleCents,
      };
      if (debtor.name !== undefined) transfer.from_name = debtor.name;
      if (creditor.name !== undefined) transfer.to_name = creditor.name;
      transfers.push(transfer);
    }

    debtor.debtCents -= settleCents;
    creditor.creditCents -= settleCents;

    if (debtor.debtCents === 0) dIdx++;
    if (creditor.creditCents === 0) cIdx++;
  }

  return transfers;
}

/**
 * Calculates direct bilateral pairwise debts across all expenses without multi-party simplification.
 * Nets debts directly between each user pair (A owes B vs B owes A).
 */
export function calculatePairwiseDebts(
  expenses: ExpenseInput[] = [],
  options: BalanceOptions = {}
): PairwiseDebt[] {
  if (!Array.isArray(expenses)) {
    throw new BalanceEngineError('Expenses must be an array', 'INVALID_INPUT');
  }

  const pairMap = new Map<string, bigint>();
  const userNames = new Map<number, string>();

  // Register member names
  const memberNameToIdMap = new Map<string, number>();
  if (Array.isArray(options.members)) {
    for (const m of options.members) {
      if (m && typeof m === 'object') {
        const uId = normalizeUserId(m.id ?? m.user_id ?? m.userId);
        if (m.name) {
          userNames.set(uId, m.name);
          memberNameToIdMap.set(m.name.trim().toLowerCase(), uId);
        }
      }
    }
  }

  // Index separate splits
  const separateSplitsByExpenseId = new Map<number, ExpenseSplitInput[]>();
  if (Array.isArray(options.splits)) {
    for (const s of options.splits) {
      if (s && s.expense_id !== undefined) {
        const expId = Number(s.expense_id);
        if (!separateSplitsByExpenseId.has(expId)) {
          separateSplitsByExpenseId.set(expId, []);
        }
        separateSplitsByExpenseId.get(expId)!.push(s);
      }
    }
  }

  const memberIdsList = Array.isArray(options.members)
    ? options.members.map((m) =>
        typeof m === 'object' && m !== null
          ? normalizeUserId(m.id ?? m.user_id ?? m.userId)
          : normalizeUserId(m)
      )
    : [];

  for (const exp of expenses) {
    if (!exp || typeof exp !== 'object') continue;
    const payerId = normalizeUserId(exp.paid_by ?? exp.payer_id);
    const amount = validateExpenseAmount(exp.amount);

    const splits = resolveEngineExpenseSplits(
      exp,
      amount,
      memberIdsList,
      separateSplitsByExpenseId,
      memberNameToIdMap
    );

    if (splits.length === 0) {
      throw new BalanceEngineError(
        `Expense ${exp.id ?? '(unidentified)'} has empty splits`,
        'INCONSISTENT_SPLITS'
      );
    }

    const seenSplitUsers = new Set<number>();
    let splitSum = 0n;
    for (const split of splits) {
      if (!split || typeof split !== 'object') {
        throw new BalanceEngineError('Invalid split: must be an object', 'INVALID_INPUT');
      }

      const splitUserId = normalizeUserId(split.user_id ?? split.userId);
      if (seenSplitUsers.has(splitUserId)) {
        throw new BalanceEngineError(
          `Duplicate split for user ${splitUserId} in expense ${exp.id ?? '(unidentified)'}`,
          'DUPLICATE_SPLIT_USER'
        );
      }
      seenSplitUsers.add(splitUserId);

      const splitAmount = validateSplitAmount(split.amount);
      splitSum += BigInt(splitAmount);

      const name = split.user_name ?? split.name;
      if (name && !userNames.has(splitUserId)) {
        userNames.set(splitUserId, name);
      }

      if (splitUserId === payerId) {
        continue; // User paying for themselves creates no bilateral debt
      }

      const key = `${splitUserId}->${payerId}`;
      const current = pairMap.get(key) ?? 0n;
      const next = current + BigInt(splitAmount);
      if (next > MAX_SAFE_INTEGER_BIGINT) {
        throw new BalanceEngineError(
          `Integer overflow in pairwise debt bucket for ${key}: ${next.toString()} cents exceeds safe integer range`,
          'INTEGER_OVERFLOW'
        );
      }
      pairMap.set(key, next);
    }

    if (splitSum !== BigInt(amount)) {
      throw new BalanceEngineError(
        `Expense ${exp.id ?? '(unidentified)'} amount (${amount}) does not equal sum of splits (${splitSum.toString()}). Conservation invariant violated.`,
        'INCONSISTENT_SPLITS'
      );
    }
  }

  // Adjust for settlements
  if (Array.isArray(options.settlements)) {
    for (const s of options.settlements) {
      if (!s || typeof s !== 'object') continue;
      const fromId = normalizeUserId(s.from ?? s.from_user_id ?? s.paid_by ?? s.payer_id);
      const toId = normalizeUserId(s.to ?? s.to_user_id ?? s.payee_id ?? s.received_by);
      if (fromId === toId) continue;

      const settlementAmount = validateSettlementAmount(s.amount);
      const forwardKey = `${fromId}->${toId}`;
      const current = pairMap.get(forwardKey) ?? 0n;
      const next = current - BigInt(settlementAmount);
      if (next < MIN_SAFE_INTEGER_BIGINT) {
        throw new BalanceEngineError(
          `Integer overflow in pairwise debt bucket for ${forwardKey}: ${next.toString()} cents exceeds safe integer range`,
          'INTEGER_OVERFLOW'
        );
      }
      pairMap.set(forwardKey, next);
    }
  }

  // Net between pairs
  const netted = new Map<string, bigint>();
  const processedPairs = new Set<string>();

  for (const key of pairMap.keys()) {
    const [u1Str, u2Str] = key.split('->');
    const u1 = Number(u1Str);
    const u2 = Number(u2Str);
    const pairId = u1 < u2 ? `${u1}:${u2}` : `${u2}:${u1}`;

    if (processedPairs.has(pairId)) continue;
    processedPairs.add(pairId);

    const forwardCents = pairMap.get(`${u1}->${u2}`) ?? 0n;
    const reverseCents = pairMap.get(`${u2}->${u1}`) ?? 0n;
    const net = forwardCents - reverseCents;
    const absNet = net > 0n ? net : -net;
    if (absNet > MAX_SAFE_INTEGER_BIGINT) {
      throw new BalanceEngineError(
        `Integer overflow in pairwise debt calculation between users ${u1} and ${u2}: ${absNet.toString()} cents exceeds safe integer range`,
        'INTEGER_OVERFLOW'
      );
    }

    if (net > 0n) {
      netted.set(`${u1}->${u2}`, net);
    } else if (net < 0n) {
      netted.set(`${u2}->${u1}`, -net);
    }
  }

  const results: PairwiseDebt[] = [];
  for (const [key, cents] of netted.entries()) {
    const [fromStr, toStr] = key.split('->');
    const fromId = Number(fromStr);
    const toId = Number(toStr);

    const debt: PairwiseDebt = {
      from: fromId,
      to: toId,
      from_user_id: fromId,
      to_user_id: toId,
      amount: Number(cents),
    };
    if (userNames.has(fromId)) debt.from_name = userNames.get(fromId);
    if (userNames.has(toId)) debt.to_name = userNames.get(toId);

    results.push(debt);
  }

  results.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    return a.to - b.to;
  });

  return results;
}

/**
 * High-level engine function combining user balances, net balances, simplified settlements,
 * bilateral pairwise debts, and total spend calculation.
 */
export function calculateBalances(
  expenses: ExpenseInput[] = [],
  options: BalanceOptions = {}
): GroupBalanceSummary {
  const balances = calculateUserBalances(expenses, options);
  const netBalances = calculateNetBalances(expenses, options);
  const settlements = simplifyDebts(balances);
  const pairwise = calculatePairwiseDebts(expenses, options);

  let totalSpend = 0;
  for (const exp of expenses) {
    if (exp && exp.amount !== undefined) {
      const amt = validateExpenseAmount(exp.amount);
      totalSpend = checkedAdd(totalSpend, amt, 'calculating total spend');
    }
  }

  return {
    balances,
    net_balances: netBalances,
    settlements,
    pairwise,
    total_spend: totalSpend,
  };
}

// Aliases
export const calculateSettlements = simplifyDebts;
export const calculateGroupBalances = calculateBalances;
