import { describe, it, expect } from 'vitest';
import {
  BalanceEngineError,
  normalizeUserId,
  validateExpenseAmount,
  validateSplitAmount,
  validateSettlementAmount,
  calculateUserBalances,
  calculateNetBalances,
  simplifyDebts,
  calculateSettlements,
  calculatePairwiseDebts,
  calculateBalances,
  calculateGroupBalances,
  checkedAdd,
  checkedSub,
  ExpenseInput,
  ExpenseSplitInput,
  SettlementInput,
  BalanceOptions,
  UserBalance,
  UserBalanceInput,
  calculateExactSplits,
  calculateRatioSplits,
  calculatePercentageSplits,
} from '../src/balances';

describe('Balance Engine - Pure integer-cent calculations & debt simplification', () => {
  describe('Input validation and integer safety', () => {
    it('normalizes valid numeric and clean string user IDs', () => {
      expect(normalizeUserId(1)).toBe(1);
      expect(normalizeUserId(42)).toBe(42);
      expect(normalizeUserId('100')).toBe(100);
      expect(normalizeUserId('  7 ')).toBe(7);
    });

    it('rejects malformed user IDs with INVALID_USER_ID', () => {
      expect(() => normalizeUserId(0)).toThrow(BalanceEngineError);
      expect(() => normalizeUserId(-1)).toThrow(BalanceEngineError);
      expect(() => normalizeUserId(1.5)).toThrow(BalanceEngineError);
      expect(() => normalizeUserId('abc')).toThrow(BalanceEngineError);
      expect(() => normalizeUserId(null)).toThrow(BalanceEngineError);
      expect(() => normalizeUserId(undefined)).toThrow(BalanceEngineError);

      try {
        normalizeUserId(-5);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INVALID_USER_ID');
      }
    });

    it('validates expense amounts as positive safe integers in cents', () => {
      expect(validateExpenseAmount(1)).toBe(1);
      expect(validateExpenseAmount(1000)).toBe(1000);
      expect(validateExpenseAmount(99999999)).toBe(99999999);

      // Floats, non-integers, zero, negative rejected
      expect(() => validateExpenseAmount(0)).toThrow(BalanceEngineError);
      expect(() => validateExpenseAmount(-100)).toThrow(BalanceEngineError);
      expect(() => validateExpenseAmount(10.5)).toThrow(BalanceEngineError);
      expect(() => validateExpenseAmount(NaN)).toThrow(BalanceEngineError);
      expect(() => validateExpenseAmount(Infinity)).toThrow(BalanceEngineError);
      expect(() => validateExpenseAmount('1000')).toThrow(BalanceEngineError);

      try {
        validateExpenseAmount(10.5);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INVALID_AMOUNT');
      }
    });

    it('validates split amounts as non-negative safe integers in cents', () => {
      expect(validateSplitAmount(0)).toBe(0);
      expect(validateSplitAmount(500)).toBe(500);

      expect(() => validateSplitAmount(-1)).toThrow(BalanceEngineError);
      expect(() => validateSplitAmount(3.14)).toThrow(BalanceEngineError);
      expect(() => validateSplitAmount('0')).toThrow(BalanceEngineError);

      try {
        validateSplitAmount(-50);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INVALID_AMOUNT');
      }
    });

    it('validates settlement amounts as positive safe integers in cents', () => {
      expect(validateSettlementAmount(1)).toBe(1);
      expect(validateSettlementAmount(500)).toBe(500);

      expect(() => validateSettlementAmount(0)).toThrow(BalanceEngineError);
      expect(() => validateSettlementAmount(-500)).toThrow(BalanceEngineError);
      expect(() => validateSettlementAmount(12.34)).toThrow(BalanceEngineError);
    });

    it('rejects malformed expenses container', () => {
      expect(() => calculateBalances(null as unknown as ExpenseInput[])).toThrow(BalanceEngineError);
      expect(() => calculateBalances('not-array' as unknown as ExpenseInput[])).toThrow(BalanceEngineError);
    });

    it('rejects duplicate users within expense splits', () => {
      const expense: ExpenseInput = {
        id: 1,
        paid_by: 1,
        amount: 1000,
        splits: [
          { user_id: 1, amount: 400 },
          { user_id: 2, amount: 300 },
          { user_id: 2, amount: 300 }, // Duplicate user 2
        ],
      };

      try {
        calculateBalances([expense]);
        expect.fail('Should have thrown DUPLICATE_SPLIT_USER');
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('DUPLICATE_SPLIT_USER');
      }
    });

    it('pins processTransactions own DUPLICATE_SPLIT_USER guard directly via calculateUserBalances', () => {
      const expense: ExpenseInput = {
        id: 1,
        paid_by: 1,
        amount: 1000,
        splits: [
          { user_id: 1, amount: 400 },
          { user_id: 2, amount: 300 },
          { user_id: 2, amount: 300 }, // Duplicate user 2
        ],
      };

      try {
        calculateUserBalances([expense]);
        expect.fail('Should have thrown DUPLICATE_SPLIT_USER from processTransactions');
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('DUPLICATE_SPLIT_USER');
      }
    });
  });

  describe('Carried invariant: exact conservation & split integrity (ON DELETE CASCADE handling)', () => {
    it('rejects torn expense where sum(splits) < expense.amount with INCONSISTENT_SPLITS', () => {
      // Simulates SQLite ON DELETE CASCADE deletion of non-payer user:
      // Original expense 900 cents split 300/300/300 among [1, 2, 3].
      // User 3 deleted directly in DB, leaving splits for user 1 and user 2 totaling 600 < 900.
      const tornExpense: ExpenseInput = {
        id: 42,
        paid_by: 1,
        amount: 900,
        splits: [
          { user_id: 1, amount: 300 },
          { user_id: 2, amount: 300 },
          // split for user 3 was deleted in SQLite via ON DELETE CASCADE
        ],
      };

      expect(() => calculateUserBalances([tornExpense])).toThrow(BalanceEngineError);
      expect(() => calculateNetBalances([tornExpense])).toThrow(BalanceEngineError);
      expect(() => calculateBalances([tornExpense])).toThrow(BalanceEngineError);

      try {
        calculateBalances([tornExpense]);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INCONSISTENT_SPLITS');
        expect((err as BalanceEngineError).message).toContain('does not equal sum of splits');
      }
    });

    it('rejects malformed expense where sum(splits) > expense.amount with INCONSISTENT_SPLITS', () => {
      const overAllocatedExpense: ExpenseInput = {
        id: 99,
        paid_by: 1,
        amount: 1000,
        splits: [
          { user_id: 1, amount: 600 },
          { user_id: 2, amount: 600 }, // sum 1200 > 1000
        ],
      };

      expect(() => calculateBalances([overAllocatedExpense])).toThrow(BalanceEngineError);
      try {
        calculateBalances([overAllocatedExpense]);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INCONSISTENT_SPLITS');
      }
    });

    it('rejects expense with empty splits array when amount > 0', () => {
      const emptySplitsExpense: ExpenseInput = {
        id: 1,
        paid_by: 1,
        amount: 500,
        splits: [],
      };

      expect(() => calculateBalances([emptySplitsExpense])).toThrow(BalanceEngineError);
      try {
        calculateBalances([emptySplitsExpense]);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INCONSISTENT_SPLITS');
      }
    });

    it('rejects expense with missing splits when no options.members provided', () => {
      const missingSplitsExpense: ExpenseInput = {
        id: 1,
        paid_by: 1,
        amount: 500,
      };

      expect(() => calculateBalances([missingSplitsExpense])).toThrow(BalanceEngineError);
      try {
        calculateBalances([missingSplitsExpense]);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INCONSISTENT_SPLITS');
      }
    });
  });

  describe('Payer credits and participant debits across single and multiple expenses', () => {
    it('calculates exact credits and debits for a 2-person expense', () => {
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1,
          amount: 6000,
          splits: [
            { user_id: 1, amount: 3000, user_name: 'Alice' },
            { user_id: 2, amount: 3000, user_name: 'Bob' },
          ],
        },
      ];

      const balances = calculateUserBalances(expenses);
      expect(balances).toHaveLength(2);

      // Alice: paid 6000, owed 3000 -> net +3000
      expect(balances[0]).toEqual({
        user_id: 1,
        userId: 1,
        name: 'Alice',
        paid: 6000,
        owed: 3000,
        net_balance: 3000,
        balance: 3000,
      });

      // Bob: paid 0, owed 3000 -> net -3000
      expect(balances[1]).toEqual({
        user_id: 2,
        userId: 2,
        name: 'Bob',
        paid: 0,
        owed: 3000,
        net_balance: -3000,
        balance: -3000,
      });

      const net = calculateNetBalances(expenses);
      expect(net).toEqual({ 1: 3000, 2: -3000 });

      // Conservation to zero
      expect(balances[0].net_balance + balances[1].net_balance).toBe(0);
    });

    it('accumulates credits and debits across multiple expenses with multiple payers', () => {
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1, // Alice pays 3000
          amount: 3000,
          splits: [
            { user_id: 1, amount: 1000, user_name: 'Alice' },
            { user_id: 2, amount: 1000, user_name: 'Bob' },
            { user_id: 3, amount: 1000, user_name: 'Charlie' },
          ],
        },
        {
          id: 2,
          paid_by: 2, // Bob pays 6000
          amount: 6000,
          splits: [
            { user_id: 1, amount: 2000, user_name: 'Alice' },
            { user_id: 2, amount: 2000, user_name: 'Bob' },
            { user_id: 3, amount: 2000, user_name: 'Charlie' },
          ],
        },
      ];

      const balances = calculateUserBalances(expenses);
      expect(balances).toHaveLength(3);

      // Alice: paid 3000, owed 1000 + 2000 = 3000 -> net 0
      expect(balances[0]).toEqual({
        user_id: 1,
        userId: 1,
        name: 'Alice',
        paid: 3000,
        owed: 3000,
        net_balance: 0,
        balance: 0,
      });

      // Bob: paid 6000, owed 1000 + 2000 = 3000 -> net +3000
      expect(balances[1]).toEqual({
        user_id: 2,
        userId: 2,
        name: 'Bob',
        paid: 6000,
        owed: 3000,
        net_balance: 3000,
        balance: 3000,
      });

      // Charlie: paid 0, owed 1000 + 2000 = 3000 -> net -3000
      expect(balances[2]).toEqual({
        user_id: 3,
        userId: 3,
        name: 'Charlie',
        paid: 0,
        owed: 3000,
        net_balance: -3000,
        balance: -3000,
      });

      // Conservation to zero
      const sumNet = balances.reduce((acc, b) => acc + b.net_balance, 0);
      expect(sumNet).toBe(0);
    });

    it('correctly handles users who paid and also owe across expenses', () => {
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1, // User 1 pays 1000 for User 2
          amount: 1000,
          splits: [{ user_id: 2, amount: 1000 }],
        },
        {
          id: 2,
          paid_by: 2, // User 2 pays 400 for User 1
          amount: 400,
          splits: [{ user_id: 1, amount: 400 }],
        },
      ];

      const balances = calculateUserBalances(expenses);
      // User 1: paid 1000, owed 400 -> net +600
      expect(balances[0].paid).toBe(1000);
      expect(balances[0].owed).toBe(400);
      expect(balances[0].net_balance).toBe(600);

      // User 2: paid 400, owed 1000 -> net -600
      expect(balances[1].paid).toBe(400);
      expect(balances[1].owed).toBe(1000);
      expect(balances[1].net_balance).toBe(-600);

      expect(balances[0].net_balance + balances[1].net_balance).toBe(0);

      // Simplified transfer: User 2 pays User 1 600 cents
      const summary = calculateBalances(expenses);
      expect(summary.settlements).toEqual([
        {
          from: 2,
          to: 1,
          from_user_id: 2,
          to_user_id: 1,
          amount: 600,
        },
      ]);
    });
  });

  describe('Odd remainders and exact conservation to zero in integer cents', () => {
    it('conserves odd remainders when splitting 100 cents across 3 users', () => {
      // 100 cents / 3: remainder 1 -> [34, 33, 33]
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1,
          amount: 100,
          splits: [
            { user_id: 1, amount: 34 },
            { user_id: 2, amount: 33 },
            { user_id: 3, amount: 33 },
          ],
        },
      ];

      const balances = calculateUserBalances(expenses);
      expect(balances[0].net_balance).toBe(66); // 100 - 34
      expect(balances[1].net_balance).toBe(-33);
      expect(balances[2].net_balance).toBe(-33);

      const netSum = balances.reduce((sum, b) => sum + b.net_balance, 0);
      expect(netSum).toBe(0);

      const summary = calculateBalances(expenses);
      expect(summary.settlements).toHaveLength(2);
      // Debtors are 2 and 3 (each owes 33). Tiebreak: user 2 then user 3.
      expect(summary.settlements).toEqual([
        { from: 2, to: 1, from_user_id: 2, to_user_id: 1, amount: 33 },
        { from: 3, to: 1, from_user_id: 3, to_user_id: 1, amount: 33 },
      ]);
    });

    it('conserves odd remainders when splitting 1 cent across 3 users', () => {
      // 1 cent / 3: splits [1, 0, 0]
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1,
          amount: 1,
          splits: [
            { user_id: 1, amount: 1 },
            { user_id: 2, amount: 0 },
            { user_id: 3, amount: 0 },
          ],
        },
      ];

      const balances = calculateUserBalances(expenses);
      expect(balances[0].net_balance).toBe(0); // paid 1, owed 1
      expect(balances[1].net_balance).toBe(0);
      expect(balances[2].net_balance).toBe(0);

      const summary = calculateBalances(expenses);
      expect(summary.settlements).toEqual([]);
      expect(summary.total_spend).toBe(1);
    });

    it('conserves exact zero over large amounts and prime remainders', () => {
      // 10000003 cents across 7 users
      const n = 7;
      const totalAmount = 10000003;
      const base = Math.floor(totalAmount / n);
      const rem = totalAmount % n;

      const splits = Array.from({ length: n }, (_, i) => ({
        user_id: i + 1,
        amount: base + (i < rem ? 1 : 0),
      }));

      const splitSum = splits.reduce((acc, s) => acc + s.amount, 0);
      expect(splitSum).toBe(totalAmount);

      const expense: ExpenseInput = {
        id: 1,
        paid_by: 1,
        amount: totalAmount,
        splits,
      };

      const summary = calculateBalances([expense]);
      const netSum = summary.balances.reduce((acc, b) => acc + b.net_balance, 0);
      expect(netSum).toBe(0);

      // Verify every transfer preserves exact net balance
      for (const b of summary.balances) {
        const received = summary.settlements
          .filter((t) => t.to === b.user_id)
          .reduce((sum, t) => sum + t.amount, 0);
        const sent = summary.settlements
          .filter((t) => t.from === b.user_id)
          .reduce((sum, t) => sum + t.amount, 0);
        expect(received - sent).toBe(b.net_balance);
      }
    });
  });

  describe('Empty and already-settled inputs', () => {
    it('returns empty results when given an empty expenses array with no options', () => {
      const summary = calculateBalances([]);
      expect(summary.balances).toEqual([]);
      expect(summary.net_balances).toEqual({});
      expect(summary.settlements).toEqual([]);
      expect(summary.pairwise).toEqual([]);
      expect(summary.total_spend).toBe(0);
    });

    it('returns zero-balance records for members when given empty expenses', () => {
      const options: BalanceOptions = {
        members: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      };

      const summary = calculateBalances([], options);
      expect(summary.balances).toHaveLength(2);
      expect(summary.balances[0]).toEqual({
        user_id: 1,
        userId: 1,
        name: 'Alice',
        paid: 0,
        owed: 0,
        net_balance: 0,
        balance: 0,
      });
      expect(summary.balances[1]).toEqual({
        user_id: 2,
        userId: 2,
        name: 'Bob',
        paid: 0,
        owed: 0,
        net_balance: 0,
        balance: 0,
      });
      expect(summary.net_balances).toEqual({ 1: 0, 2: 0 });
      expect(summary.settlements).toEqual([]);
      expect(summary.total_spend).toBe(0);
    });

    it('returns empty settlements when inputs are already settled (net balances all 0)', () => {
      // Alice pays 1000 for Bob, Bob pays 1000 for Alice
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1,
          amount: 1000,
          splits: [{ user_id: 2, amount: 1000 }],
        },
        {
          id: 2,
          paid_by: 2,
          amount: 1000,
          splits: [{ user_id: 1, amount: 1000 }],
        },
      ];

      const summary = calculateBalances(expenses);
      expect(summary.balances[0].net_balance).toBe(0);
      expect(summary.balances[1].net_balance).toBe(0);
      expect(summary.settlements).toEqual([]);
      expect(summary.pairwise).toEqual([]);
    });

    it('simplifyDebts handles null, undefined, empty array, or all-zero map', () => {
      expect(simplifyDebts(null)).toEqual([]);
      expect(simplifyDebts(undefined)).toEqual([]);
      expect(simplifyDebts([])).toEqual([]);
      expect(simplifyDebts({})).toEqual([]);
      expect(simplifyDebts({ 1: 0, 2: 0, 3: 0 })).toEqual([]);
      expect(simplifyDebts(new Map([[1, 0], [2, 0]]))).toEqual([]);
    });
  });

  describe('Deterministic debt simplification', () => {
    it('produces identical output across 100 iterations', () => {
      const netBalances = {
        1: 5000,
        2: 2500,
        3: -3000,
        4: -4500,
      };

      const baseline = simplifyDebts(netBalances);

      for (let i = 0; i < 100; i++) {
        const iteration = simplifyDebts(netBalances);
        expect(iteration).toEqual(baseline);
      }
    });

    it('breaks ties deterministically using user_id ASC for both debtors and creditors', () => {
      // Two creditors with equal credit (1000): User 1 and User 3
      // Two debtors with equal debt (1000): User 2 and User 4
      const netBalances = {
        3: 1000,
        1: 1000,
        4: -1000,
        2: -1000,
      };

      const transfers = simplifyDebts(netBalances);
      expect(transfers).toHaveLength(2);

      // Debtor tie-breaker: user 2 before user 4
      // Creditor tie-breaker: user 1 before user 3
      expect(transfers[0]).toEqual({
        from: 2,
        to: 1,
        from_user_id: 2,
        to_user_id: 1,
        amount: 1000,
      });
      expect(transfers[1]).toEqual({
        from: 4,
        to: 3,
        from_user_id: 4,
        to_user_id: 3,
        amount: 1000,
      });
    });

    it('pins documented amount DESC sort for debtors and creditors in simplifyDebts', () => {
      // 1. Debtor amount DESC: debtor 2 (300) must settle before debtor 1 (100)
      const debtorTestBalances = {
        1: -100,
        2: -300,
        3: 200,
        4: 200,
      };
      const debtorTransfers = simplifyDebts(debtorTestBalances);
      expect(debtorTransfers).toEqual([
        {
          from: 2,
          to: 3,
          from_user_id: 2,
          to_user_id: 3,
          amount: 200,
        },
        {
          from: 2,
          to: 4,
          from_user_id: 2,
          to_user_id: 4,
          amount: 100,
        },
        {
          from: 1,
          to: 4,
          from_user_id: 1,
          to_user_id: 4,
          amount: 100,
        },
      ]);

      // 2. Creditor amount DESC: creditor 4 (300) must settle before creditor 3 (100)
      const creditorTestBalances = {
        1: -200,
        2: -200,
        3: 100,
        4: 300,
      };
      const creditorTransfers = simplifyDebts(creditorTestBalances);
      expect(creditorTransfers).toEqual([
        {
          from: 1,
          to: 4,
          from_user_id: 1,
          to_user_id: 4,
          amount: 200,
        },
        {
          from: 2,
          to: 4,
          from_user_id: 2,
          to_user_id: 4,
          amount: 100,
        },
        {
          from: 2,
          to: 3,
          from_user_id: 2,
          to_user_id: 3,
          amount: 100,
        },
      ]);
    });

    it('guarantees transfer amounts are strictly positive safe integers', () => {
      const netBalances = {
        1: 7000,
        2: -2000,
        3: -5000,
      };

      const transfers = simplifyDebts(netBalances);
      for (const t of transfers) {
        expect(typeof t.amount).toBe('number');
        expect(Number.isSafeInteger(t.amount)).toBe(true);
        expect(t.amount).toBeGreaterThan(0);
      }
    });

    it('every simplified transfer preserves the exact input net position for every user', () => {
      // Complex 6-person settlement
      const netBalances: Record<number, number> = {
        1: 15000,  // creditor
        2: 5000,   // creditor
        3: 2000,   // creditor
        4: -8000,  // debtor
        5: -10000, // debtor
        6: -4000,  // debtor
      };

      const transfers = simplifyDebts(netBalances);
      expect(transfers.length).toBeLessThanOrEqual(5); // At most N-1 transactions

      // Verify each user's net position is exactly preserved
      for (const [userIdStr, expectedNet] of Object.entries(netBalances)) {
        const uId = Number(userIdStr);
        const totalReceived = transfers
          .filter((t) => t.to === uId)
          .reduce((sum, t) => sum + t.amount, 0);
        const totalSent = transfers
          .filter((t) => t.from === uId)
          .reduce((sum, t) => sum + t.amount, 0);

        expect(totalReceived - totalSent).toBe(expectedNet);
      }
    });

    it('rejects net balances that do not sum to zero with CONSERVATION_VIOLATION', () => {
      const violatedNetBalances = {
        1: 5000,
        2: -3000, // Sum = +2000 != 0
      };

      expect(() => simplifyDebts(violatedNetBalances)).toThrow(BalanceEngineError);
      try {
        simplifyDebts(violatedNetBalances);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('CONSERVATION_VIOLATION');
      }
    });

    it('rejects floating-point or non-integer net balances with INVALID_AMOUNT', () => {
      const floatBalances = {
        1: 10.5,
        2: -10.5,
      };

      expect(() => simplifyDebts(floatBalances)).toThrow(BalanceEngineError);
      try {
        simplifyDebts(floatBalances);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INVALID_AMOUNT');
      }
    });

    it('preserves user names on transfers when available from UserBalance[]', () => {
      const userBalances: UserBalance[] = [
        {
          user_id: 1,
          userId: 1,
          name: 'Alice',
          paid: 2000,
          owed: 0,
          net_balance: 2000,
          balance: 2000,
        },
        {
          user_id: 2,
          userId: 2,
          name: 'Bob',
          paid: 0,
          owed: 2000,
          net_balance: -2000,
          balance: -2000,
        },
      ];

      const transfers = simplifyDebts(userBalances);
      expect(transfers).toEqual([
        {
          from: 2,
          to: 1,
          from_user_id: 2,
          to_user_id: 1,
          from_name: 'Bob',
          to_name: 'Alice',
          amount: 2000,
        },
      ]);
    });
  });

  describe('No floating-point currency arithmetic', () => {
    it('strictly requires all input amounts and output balances to be integer cents', () => {
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1,
          amount: 10000, // 100.00 USD represented as integer cents
          splits: [
            { user_id: 1, amount: 5000 },
            { user_id: 2, amount: 5000 },
          ],
        },
      ];

      const summary = calculateBalances(expenses);
      expect(Number.isInteger(summary.total_spend)).toBe(true);
      for (const b of summary.balances) {
        expect(Number.isInteger(b.paid)).toBe(true);
        expect(Number.isInteger(b.owed)).toBe(true);
        expect(Number.isInteger(b.net_balance)).toBe(true);
        expect(Number.isInteger(b.balance)).toBe(true);
      }
      for (const s of summary.settlements) {
        expect(Number.isInteger(s.amount)).toBe(true);
      }
    });

    it('rejects floating-point currency inputs', () => {
      const floatExpense: ExpenseInput = {
        id: 1,
        paid_by: 1,
        amount: 100.5,
        splits: [{ user_id: 1, amount: 100.5 }],
      };

      expect(() => calculateBalances([floatExpense])).toThrow(BalanceEngineError);
    });
  });

  describe('Options: separate splits, member-based equal splits, and settlements', () => {
    it('supports separate options.splits indexed by expense_id', () => {
      const expenses: ExpenseInput[] = [
        { id: 10, paid_by: 1, amount: 3000 },
        { id: 20, paid_by: 2, amount: 1500 },
      ];

      const separateSplits = [
        { expense_id: 10, user_id: 1, amount: 1500 },
        { expense_id: 10, user_id: 2, amount: 1500 },
        { expense_id: 20, user_id: 1, amount: 750 },
        { expense_id: 20, user_id: 2, amount: 750 },
      ];

      const summary = calculateBalances(expenses, { splits: separateSplits });
      expect(summary.total_spend).toBe(4500);

      // User 1: paid 3000, owed 1500 + 750 = 2250 -> net +750
      expect(summary.balances[0].net_balance).toBe(750);
      // User 2: paid 1500, owed 1500 + 750 = 2250 -> net -750
      expect(summary.balances[1].net_balance).toBe(-750);
    });

    it('derives equal splits from options.members when expense.splits is omitted', () => {
      const expenses: ExpenseInput[] = [
        { id: 1, paid_by: 1, amount: 100 }, // No splits property
      ];
      const members = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ];

      const summary = calculateBalances(expenses, { members });
      expect(summary.balances).toHaveLength(3);
      // Remainder distribution: 100 / 3 -> [34, 33, 33]
      expect(summary.balances[0].owed).toBe(34);
      expect(summary.balances[1].owed).toBe(33);
      expect(summary.balances[2].owed).toBe(33);
      expect(summary.balances[0].net_balance).toBe(66);
    });

    it('adjusts balances and settles debts when options.settlements are provided', () => {
      // User 1 paid 2000 for User 2 (net: User 1 +2000, User 2 -2000)
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1,
          amount: 2000,
          splits: [{ user_id: 2, amount: 2000 }],
        },
      ];

      // User 2 pays User 1 1500 as a partial settlement
      const settlements = [
        {
          from: 2,
          to: 1,
          amount: 1500,
        },
      ];

      const summary = calculateBalances(expenses, { settlements });
      // User 1: paid 2000, owed 1500 from settlement -> net +500
      expect(summary.balances[0].net_balance).toBe(500);
      // User 2: paid 1500 from settlement, owed 2000 -> net -500
      expect(summary.balances[1].net_balance).toBe(-500);

      // Remaining simplified settlement: User 2 pays User 1 500
      expect(summary.settlements).toEqual([
        {
          from: 2,
          to: 1,
          from_user_id: 2,
          to_user_id: 1,
          amount: 500,
        },
      ]);
    });

    it('rejects self-settlement (from === to)', () => {
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1,
          amount: 1000,
          splits: [{ user_id: 1, amount: 1000 }],
        },
      ];
      const settlements = [{ from: 1, to: 1, amount: 500 }];

      expect(() => calculateBalances(expenses, { settlements })).toThrow(BalanceEngineError);
    });
  });

  describe('Bilateral pairwise debts calculation', () => {
    it('calculates and nets direct bilateral debts between pairs', () => {
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1, // User 1 pays 1000 for User 2
          amount: 1000,
          splits: [{ user_id: 2, amount: 1000 }],
        },
        {
          id: 2,
          paid_by: 2, // User 2 pays 400 for User 1
          amount: 400,
          splits: [{ user_id: 1, amount: 400 }],
        },
      ];

      const pairwise = calculatePairwiseDebts(expenses);
      expect(pairwise).toEqual([
        {
          from: 2,
          to: 1,
          from_user_id: 2,
          to_user_id: 1,
          amount: 600, // 1000 - 400
        },
      ]);
    });

    it('correctly nets pairwise debts when smaller bucket is inserted first (net < 0 branch)', () => {
      // u1 pays 100 split 50/50, then u2 pays 300 split 150/150: correct output is 1->2: 100
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1,
          amount: 100,
          splits: [
            { user_id: 1, amount: 50 },
            { user_id: 2, amount: 50 },
          ],
        },
        {
          id: 2,
          paid_by: 2,
          amount: 300,
          splits: [
            { user_id: 1, amount: 150 },
            { user_id: 2, amount: 150 },
          ],
        },
      ];

      const pairwise = calculatePairwiseDebts(expenses);
      expect(pairwise).toEqual([
        {
          from: 1,
          to: 2,
          from_user_id: 1,
          to_user_id: 2,
          amount: 100,
        },
      ]);
    });

    it('pairwise debts ignore self-splitting portions', () => {
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1,
          amount: 1000,
          splits: [
            { user_id: 1, amount: 500 }, // self-split
            { user_id: 2, amount: 500 },
          ],
        },
      ];

      const pairwise = calculatePairwiseDebts(expenses);
      expect(pairwise).toEqual([
        {
          from: 2,
          to: 1,
          from_user_id: 2,
          to_user_id: 1,
          amount: 500,
        },
      ]);
    });
  });

  describe('Aliases and export parity', () => {
    it('provides calculateSettlements as alias for simplifyDebts', () => {
      expect(calculateSettlements).toBe(simplifyDebts);
    });

    it('provides calculateGroupBalances as alias for calculateBalances', () => {
      expect(calculateGroupBalances).toBe(calculateBalances);
    });
  });

  describe('Overflow-safe accumulation and safe-integer boundaries', () => {
    const M = Number.MAX_SAFE_INTEGER;

    it('rejects unchecked accumulation leaving safe-integer domain with INTEGER_OVERFLOW (steward regression 1)', () => {
      const expenses: ExpenseInput[] = [1, 2, 3].map((id) => ({
        id,
        paid_by: 1,
        amount: M,
        splits: [{ user_id: 2, amount: M }],
      }));

      expect(() => calculateUserBalances(expenses)).toThrow(BalanceEngineError);
      try {
        calculateUserBalances(expenses);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INTEGER_OVERFLOW');
        expect((err as BalanceEngineError).message).toContain('paid amount for user 1');
      }

      expect(() => calculateNetBalances(expenses)).toThrow(BalanceEngineError);
      expect(() => calculateBalances(expenses)).toThrow(BalanceEngineError);
    });

    it('handles MAX_SAFE_INTEGER in simplifyDebts without false conservation failure (steward regression 2)', () => {
      const settlements = simplifyDebts({
        1: M,
        2: M,
        3: M,
        4: -M,
        5: -M,
        6: -M,
      });

      expect(settlements).toHaveLength(3);
      expect(settlements).toEqual([
        { from: 4, to: 1, from_user_id: 4, to_user_id: 1, amount: M },
        { from: 5, to: 2, from_user_id: 5, to_user_id: 2, amount: M },
        { from: 6, to: 3, from_user_id: 6, to_user_id: 3, amount: M },
      ]);
      for (const t of settlements) {
        expect(Number.isSafeInteger(t.amount)).toBe(true);
      }
    });

    it('enforces safe integer addition and subtraction boundaries with checkedAdd and checkedSub', () => {
      expect(checkedAdd(M, 0)).toBe(M);
      expect(checkedAdd(M - 5, 5)).toBe(M);
      expect(checkedSub(M, 0)).toBe(M);
      expect(checkedSub(M, M)).toBe(0);

      expect(() => checkedAdd(M, 1)).toThrow(BalanceEngineError);
      try {
        checkedAdd(M, 1, 'test addition');
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INTEGER_OVERFLOW');
        expect((err as BalanceEngineError).message).toContain('test addition');
      }

      expect(() => checkedSub(Number.MIN_SAFE_INTEGER, 1)).toThrow(BalanceEngineError);
      try {
        checkedSub(Number.MIN_SAFE_INTEGER, 1, 'test subtraction');
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INTEGER_OVERFLOW');
      }

      expect(() => checkedSub(M, -1)).toThrow(BalanceEngineError);
    });

    it('rejects non-safe-integer arguments in checkedAdd and checkedSub with INVALID_AMOUNT', () => {
      expect(() => checkedAdd(1.5, 1)).toThrow(BalanceEngineError);
      expect(() => checkedAdd(1, 1.5)).toThrow(BalanceEngineError);
      expect(() => checkedSub(1.5, 1)).toThrow(BalanceEngineError);
      expect(() => checkedSub(1, 1.5)).toThrow(BalanceEngineError);
      expect(() => checkedAdd(NaN, 1)).toThrow(BalanceEngineError);
      expect(() => checkedSub(Infinity, 1)).toThrow(BalanceEngineError);

      try {
        checkedAdd(1.5, 1);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INVALID_AMOUNT');
        expect((err as BalanceEngineError).message).toContain('First argument to checkedAdd must be a safe integer');
      }

      try {
        checkedAdd(1, 1.5);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INVALID_AMOUNT');
        expect((err as BalanceEngineError).message).toContain('Second argument to checkedAdd must be a safe integer');
      }

      try {
        checkedSub(1.5, 1);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INVALID_AMOUNT');
        expect((err as BalanceEngineError).message).toContain('First argument to checkedSub must be a safe integer');
      }

      try {
        checkedSub(1, 1.5);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INVALID_AMOUNT');
        expect((err as BalanceEngineError).message).toContain('Second argument to checkedSub must be a safe integer');
      }
    });

    it('audits paid accumulator overflow across multiple expenses', () => {
      const expenses: ExpenseInput[] = [
        { id: 1, paid_by: 1, amount: M, splits: [{ user_id: 1, amount: M }] },
        { id: 2, paid_by: 1, amount: 1, splits: [{ user_id: 1, amount: 1 }] },
      ];

      expect(() => calculateUserBalances(expenses)).toThrow(BalanceEngineError);
      try {
        calculateUserBalances(expenses);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INTEGER_OVERFLOW');
        expect((err as BalanceEngineError).message).toContain('paid amount for user 1');
      }
    });

    it('audits owed accumulator overflow across multiple expenses', () => {
      const expenses: ExpenseInput[] = [
        { id: 1, paid_by: 1, amount: M, splits: [{ user_id: 2, amount: M }] },
        { id: 2, paid_by: 3, amount: 1, splits: [{ user_id: 2, amount: 1 }] },
      ];

      expect(() => calculateUserBalances(expenses)).toThrow(BalanceEngineError);
      try {
        calculateUserBalances(expenses);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INTEGER_OVERFLOW');
        expect((err as BalanceEngineError).message).toContain('owed amount for user 2');
      }
    });

    it('audits settlement accumulators overflow for paid and owed', () => {
      // Settlement paid overflow
      const expense: ExpenseInput = {
        id: 1,
        paid_by: 1,
        amount: M,
        splits: [{ user_id: 2, amount: M }],
      };
      const optionsPaidOverflow: BalanceOptions = {
        settlements: [{ from: 1, to: 2, amount: 1 }],
      };

      expect(() => calculateUserBalances([expense], optionsPaidOverflow)).toThrow(BalanceEngineError);
      try {
        calculateUserBalances([expense], optionsPaidOverflow);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INTEGER_OVERFLOW');
        expect((err as BalanceEngineError).message).toContain('settlement paid amount for user 1');
      }

      // Settlement owed overflow
      const optionsOwedOverflow: BalanceOptions = {
        settlements: [{ from: 3, to: 2, amount: 1 }],
      };
      expect(() => calculateUserBalances([expense], optionsOwedOverflow)).toThrow(BalanceEngineError);
      try {
        calculateUserBalances([expense], optionsOwedOverflow);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INTEGER_OVERFLOW');
        expect((err as BalanceEngineError).message).toContain('settlement owed amount for user 2');
      }
    });

    it('audits pairwise debt accumulator overflow in calculatePairwiseDebts', () => {
      const expenses: ExpenseInput[] = [
        { id: 1, paid_by: 1, amount: M, splits: [{ user_id: 2, amount: M }] },
        { id: 2, paid_by: 1, amount: 1, splits: [{ user_id: 2, amount: 1 }] },
      ];

      expect(() => calculatePairwiseDebts(expenses)).toThrow(BalanceEngineError);
      try {
        calculatePairwiseDebts(expenses);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INTEGER_OVERFLOW');
        expect((err as BalanceEngineError).message).toContain('pairwise debt bucket');
      }
    });

    it('audits pairwise debt netting overflow in calculatePairwiseDebts when bucket difference exceeds MAX_SAFE_INTEGER', () => {
      const expenses: ExpenseInput[] = [
        {
          id: 1,
          payer_id: 2,
          amount: M,
          splits: [{ user_id: 1, amount: M }],
        },
      ];
      const settlements: SettlementInput[] = [
        {
          from_user_id: 2,
          to_user_id: 1,
          amount: M,
        },
      ];

      expect(() => calculatePairwiseDebts(expenses, { settlements })).toThrow(BalanceEngineError);
      try {
        calculatePairwiseDebts(expenses, { settlements });
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INTEGER_OVERFLOW');
        expect((err as BalanceEngineError).message).toContain('pairwise debt calculation between users 1 and 2');
        expect((err as BalanceEngineError).message).toContain('18014398509481982');
      }
    });

    it('audits total_spend accumulator overflow in calculateBalances', () => {
      // 3 users each paying M for themselves - user paid and owed do not exceed M, but total spend is 3*M
      const expenses: ExpenseInput[] = [
        { id: 1, paid_by: 1, amount: M, splits: [{ user_id: 1, amount: M }] },
        { id: 2, paid_by: 2, amount: M, splits: [{ user_id: 2, amount: M }] },
        { id: 3, paid_by: 3, amount: M, splits: [{ user_id: 3, amount: M }] },
      ];

      expect(() => calculateBalances(expenses)).toThrow(BalanceEngineError);
      try {
        calculateBalances(expenses);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INTEGER_OVERFLOW');
        expect((err as BalanceEngineError).message).toContain('calculating total spend');
      }
    });

    it('conserves exact split sum invariant using BigInt without float rounding at MAX_SAFE_INTEGER', () => {
      const expense: ExpenseInput = {
        id: 1,
        paid_by: 1,
        amount: M,
        splits: [
          { user_id: 1, amount: M - 100 },
          { user_id: 2, amount: 100 },
        ],
      };

      const balances = calculateUserBalances([expense]);
      expect(balances).toHaveLength(2);
      expect(balances[0].paid).toBe(M);
      expect(balances[0].owed).toBe(M - 100);
      expect(balances[0].net_balance).toBe(100);
      expect(balances[1].net_balance).toBe(-100);

      // Mutate split sum to violate conservation by 1 cent
      const inconsistentExpense: ExpenseInput = {
        id: 1,
        paid_by: 1,
        amount: M,
        splits: [
          { user_id: 1, amount: M - 100 },
          { user_id: 2, amount: 101 }, // M + 1
        ],
      };

      expect(() => calculateUserBalances([inconsistentExpense])).toThrow(BalanceEngineError);
      try {
        calculateUserBalances([inconsistentExpense]);
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INCONSISTENT_SPLITS');
        expect((err as BalanceEngineError).message).toContain(String(M));
      }
    });
  });

  describe('Steward review round 3 regressions', () => {
    it('Finding 1: rejects duplicate user ids in simplifyDebts array input with DUPLICATE_USER', () => {
      // Steward probe: duplicate user id 1 with -100 and +100
      const input: UserBalanceInput[] = [
        { user_id: 1, net_balance: -100 },
        { user_id: 1, net_balance: 100 },
      ];

      expect(() => simplifyDebts(input)).toThrow(BalanceEngineError);
      try {
        simplifyDebts(input);
        expect.fail('Should have thrown DUPLICATE_USER');
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('DUPLICATE_USER');
      }
    });

    it('Finding 2: rejects duplicate split user in calculatePairwiseDebts with DUPLICATE_SPLIT_USER', () => {
      // Steward probe: duplicate split for user 2 in expense 1
      const exp: ExpenseInput[] = [
        {
          id: 1,
          paid_by: 1,
          amount: 200,
          splits: [
            { user_id: 2, amount: 100 },
            { user_id: 2, amount: 100 },
          ],
        },
      ];

      expect(() => calculatePairwiseDebts(exp)).toThrow(BalanceEngineError);
      try {
        calculatePairwiseDebts(exp);
        expect.fail('Should have thrown DUPLICATE_SPLIT_USER');
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('DUPLICATE_SPLIT_USER');
      }
    });

    it('Finding 1 (edge case): rejects duplicate user ids in simplifyDebts array even with identical signs or zero balances', () => {
      // Same sign
      expect(() =>
        simplifyDebts([
          { user_id: 1, net_balance: 50 },
          { user_id: 1, net_balance: 50 },
          { user_id: 2, net_balance: -100 },
        ])
      ).toThrow(BalanceEngineError);

      try {
        simplifyDebts([
          { user_id: 1, net_balance: 50 },
          { user_id: 1, net_balance: 50 },
          { user_id: 2, net_balance: -100 },
        ]);
        expect.fail('Should have thrown DUPLICATE_USER');
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('DUPLICATE_USER');
      }

      // Zero balance duplicate
      try {
        simplifyDebts([
          { user_id: 1, net_balance: 0 },
          { user_id: 1, net_balance: 0 },
        ]);
        expect.fail('Should have thrown DUPLICATE_USER');
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('DUPLICATE_USER');
      }
    });

    it('Finding 2 (edge cases): validates splits structure and rejects empty or non-object splits in calculatePairwiseDebts', () => {
      // Empty splits array
      expect(() =>
        calculatePairwiseDebts([{ id: 1, paid_by: 1, amount: 100, splits: [] }])
      ).toThrow(BalanceEngineError);

      try {
        calculatePairwiseDebts([{ id: 1, paid_by: 1, amount: 100, splits: [] }]);
        expect.fail('Should have thrown INCONSISTENT_SPLITS');
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INCONSISTENT_SPLITS');
      }

      // Non-object split
      try {
        calculatePairwiseDebts([
          { id: 1, paid_by: 1, amount: 100, splits: [null as unknown as ExpenseSplitInput] },
        ]);
        expect.fail('Should have thrown INVALID_INPUT');
      } catch (err) {
        expect(err).toBeInstanceOf(BalanceEngineError);
        expect((err as BalanceEngineError).code).toBe('INVALID_INPUT');
      }
    });
  });

  describe('Task 9 - Pure balance engine custom splits arithmetic & remainder distribution', () => {
    describe('calculateExactSplits', () => {
      it('calculates exact integer-cent splits summing to total', () => {
        const splits = calculateExactSplits(1000, [
          { userId: 1, amount: 600, name: 'Alice' },
          { userId: 2, amount: 400, name: 'Bob' },
        ]);
        expect(splits).toEqual([
          { userId: 1, amount: 600, name: 'Alice' },
          { userId: 2, amount: 400, name: 'Bob' },
        ]);
        expect(splits.reduce((acc, s) => acc + s.amount, 0)).toBe(1000);
      });

      it('sorts calculated exact splits by userId ASC deterministically', () => {
        const splits = calculateExactSplits(1000, [
          { userId: 3, amount: 200 },
          { userId: 1, amount: 500 },
          { userId: 2, amount: 300 },
        ]);
        expect(splits.map((s) => s.userId)).toEqual([1, 2, 3]);
        expect(splits.map((s) => s.amount)).toEqual([500, 300, 200]);
      });

      it('rejects empty or non-array splits', () => {
        expect(() => calculateExactSplits(1000, [])).toThrow(BalanceEngineError);
        expect(() => calculateExactSplits(1000, null as unknown as [])).toThrow(BalanceEngineError);
      });

      it('rejects non-object split items', () => {
        expect(() => calculateExactSplits(1000, [null as unknown as { userId: number; amount: number }])).toThrow(
          BalanceEngineError
        );
      });

      it('rejects duplicate participants in exact splits', () => {
        expect(() =>
          calculateExactSplits(1000, [
            { userId: 1, amount: 500 },
            { userId: 1, amount: 500 },
          ])
        ).toThrow(BalanceEngineError);
      });

      it('rejects non-positive, float, or unsafe split amounts', () => {
        expect(() => calculateExactSplits(1000, [{ userId: 1, amount: 0 }, { userId: 2, amount: 1000 }])).toThrow(
          BalanceEngineError
        );
        expect(() => calculateExactSplits(1000, [{ userId: 1, amount: -100 }, { userId: 2, amount: 1100 }])).toThrow(
          BalanceEngineError
        );
        expect(() => calculateExactSplits(1000, [{ userId: 1, amount: 500.5 }, { userId: 2, amount: 499.5 }])).toThrow(
          BalanceEngineError
        );
        expect(() =>
          calculateExactSplits(1000, [{ userId: 1, amount: Number.MAX_SAFE_INTEGER + 1 }, { userId: 2, amount: 100 }])
        ).toThrow(BalanceEngineError);
      });

      it('rejects splits when sum does not equal total amount exactly', () => {
        // sum < total
        expect(() =>
          calculateExactSplits(1000, [
            { userId: 1, amount: 500 },
            { userId: 2, amount: 499 },
          ])
        ).toThrow(BalanceEngineError);

        // sum > total
        expect(() =>
          calculateExactSplits(1000, [
            { userId: 1, amount: 500 },
            { userId: 2, amount: 501 },
          ])
        ).toThrow(BalanceEngineError);
      });
    });

    describe('calculateRatioSplits', () => {
      it('calculates ratio splits accurately with deterministic largest remainder distribution', () => {
        // 1000 cents with 1:2:3 ratios across users 1, 2, 3
        // totalWeight = 6
        // user 1: 1000/6 = 166 rem 4 -> gets +1 cent -> 167
        // user 2: 2000/6 = 333 rem 2 -> 333
        // user 3: 3000/6 = 500 rem 0 -> 500
        const splits = calculateRatioSplits(1000, [
          { userId: 1, ratio: 1 },
          { userId: 2, ratio: 2 },
          { userId: 3, ratio: 3 },
        ]);
        expect(splits).toEqual([
          { userId: 1, amount: 167, name: null },
          { userId: 2, amount: 333, name: null },
          { userId: 3, amount: 500, name: null },
        ]);
        expect(splits.reduce((acc, s) => acc + s.amount, 0)).toBe(1000);
      });

      it('pins tiebreaking determinism by userId ASC when fractional remainders are equal', () => {
        // 101 cents with 1:1 ratio between user 1 and user 2
        // user 1 has rem 1, user 2 has rem 1
        // tiebreaker allocates extra cent to lowest userId (user 1)
        const splits = calculateRatioSplits(101, [
          { userId: 2, ratio: 1 },
          { userId: 1, ratio: 1 },
        ]);
        expect(splits).toEqual([
          { userId: 1, amount: 51, name: null },
          { userId: 2, amount: 50, name: null },
        ]);
        expect(splits.reduce((acc, s) => acc + s.amount, 0)).toBe(101);
      });

      it('handles 1 cent total amount correctly without throwing', () => {
        const splits = calculateRatioSplits(1, [
          { userId: 1, ratio: 1 },
          { userId: 2, ratio: 1 },
        ]);
        expect(splits).toEqual([
          { userId: 1, amount: 1, name: null },
          { userId: 2, amount: 0, name: null },
        ]);
        expect(splits.reduce((acc, s) => acc + s.amount, 0)).toBe(1);
      });

      it('handles decimal ratios (e.g. 1.5 : 2.5)', () => {
        // 400 cents with 1.5 : 2.5 ratio -> 150 : 250
        const splits = calculateRatioSplits(400, [
          { userId: 1, ratio: 1.5 },
          { userId: 2, ratio: 2.5 },
        ]);
        expect(splits).toEqual([
          { userId: 1, amount: 150, name: null },
          { userId: 2, amount: 250, name: null },
        ]);
        expect(splits.reduce((acc, s) => acc + s.amount, 0)).toBe(400);
      });

      it('rejects empty, duplicate, or non-positive ratios', () => {
        expect(() => calculateRatioSplits(1000, [])).toThrow(BalanceEngineError);
        expect(() =>
          calculateRatioSplits(1000, [
            { userId: 1, ratio: 1 },
            { userId: 1, ratio: 2 },
          ])
        ).toThrow(BalanceEngineError);
        expect(() =>
          calculateRatioSplits(1000, [
            { userId: 1, ratio: 0 },
            { userId: 2, ratio: 1 },
          ])
        ).toThrow(BalanceEngineError);
        expect(() =>
          calculateRatioSplits(1000, [
            { userId: 1, ratio: -1 },
            { userId: 2, ratio: 1 },
          ])
        ).toThrow(BalanceEngineError);
        expect(() =>
          calculateRatioSplits(1000, [
            { userId: 1, ratio: NaN },
            { userId: 2, ratio: 1 },
          ])
        ).toThrow(BalanceEngineError);
        expect(() =>
          calculateRatioSplits(1000, [
            { userId: 1, ratio: 1, shares: 2 },
            { userId: 2, ratio: 1 },
          ])
        ).toThrow(BalanceEngineError);
      });

      it('rejects ratio that overflows scaled multiplication with BalanceEngineError', () => {
        expect(() =>
          calculateRatioSplits(1000, [
            { userId: 1, ratio: 0.5 },
            { userId: 2, ratio: 1e308 },
          ])
        ).toThrow(BalanceEngineError);
      });

      it('preserves exact BigInt remainder ordering beyond 2^53', () => {
        const splits = calculateRatioSplits(7, [
          { userId: 1, ratio: 1e290 },
          { userId: 2, ratio: 1.3e291 },
        ]);
        expect(splits).toEqual([
          { userId: 1, amount: 0, name: null },
          { userId: 2, amount: 7, name: null },
        ]);
        expect(splits.reduce((acc, s) => acc + s.amount, 0)).toBe(7);
      });

      it('property test: sum(splits) === total for 1,000 random ratio scenarios', () => {
        for (let seed = 1; seed <= 1000; seed++) {
          const total = (seed * 997) % 500000 + 1; // 1 to 500,000 cents
          const numMembers = (seed % 7) + 2; // 2 to 8 members
          const ratios = [];
          for (let m = 1; m <= numMembers; m++) {
            const r = ((seed * m * 31) % 100) + 1; // 1 to 100
            ratios.push({ userId: m, ratio: r });
          }
          const result = calculateRatioSplits(total, ratios);
          const sum = result.reduce((acc, s) => acc + s.amount, 0);
          expect(sum).toBe(total);
          for (const s of result) {
            expect(Number.isSafeInteger(s.amount)).toBe(true);
            expect(s.amount).toBeGreaterThanOrEqual(0);
          }
        }
      });
    });

    describe('calculatePercentageSplits', () => {
      it('calculates exact percentage splits summing to 100%', () => {
        const splits = calculatePercentageSplits(10000, [
          { userId: 1, percentage: 60 },
          { userId: 2, percentage: 40 },
        ]);
        expect(splits).toEqual([
          { userId: 1, amount: 6000, name: null },
          { userId: 2, amount: 4000, name: null },
        ]);
        expect(splits.reduce((acc, s) => acc + s.amount, 0)).toBe(10000);
      });

      it('allocates remainder cents deterministically to highest fractional percentage', () => {
        // 1000 cents with 33.33%, 33.33%, 33.34%
        // user 3 has fractional 0.4 vs 0.3 -> user 3 absorbs the remainder cent
        const splits = calculatePercentageSplits(1000, [
          { userId: 1, percentage: 33.33 },
          { userId: 2, percentage: 33.33 },
          { userId: 3, percentage: 33.34 },
        ]);
        expect(splits).toEqual([
          { userId: 1, amount: 333, name: null },
          { userId: 2, amount: 333, name: null },
          { userId: 3, amount: 334, name: null },
        ]);
        expect(splits.reduce((acc, s) => acc + s.amount, 0)).toBe(1000);
      });

      it('pins tiebreaking determinism by userId ASC when percentages are equal', () => {
        // 101 cents with 50% / 50%
        const splits = calculatePercentageSplits(101, [
          { userId: 2, percentage: 50 },
          { userId: 1, percentage: 50 },
        ]);
        expect(splits).toEqual([
          { userId: 1, amount: 51, name: null },
          { userId: 2, amount: 50, name: null },
        ]);
        expect(splits.reduce((acc, s) => acc + s.amount, 0)).toBe(101);
      });

      it('rejects percentages that do not total 100', () => {
        expect(() =>
          calculatePercentageSplits(1000, [
            { userId: 1, percentage: 50 },
            { userId: 2, percentage: 49 },
          ])
        ).toThrow(BalanceEngineError);
        expect(() =>
          calculatePercentageSplits(1000, [
            { userId: 1, percentage: 50 },
            { userId: 2, percentage: 51 },
          ])
        ).toThrow(BalanceEngineError);
        // Decimal proportions like 0.5 + 0.5 = 1.0 must be rejected
        expect(() =>
          calculatePercentageSplits(1000, [
            { userId: 1, percentage: 0.5 },
            { userId: 2, percentage: 0.5 },
          ])
        ).toThrow(BalanceEngineError);
      });

      it('rejects non-positive, empty, or duplicate percentages', () => {
        expect(() => calculatePercentageSplits(1000, [])).toThrow(BalanceEngineError);
        expect(() =>
          calculatePercentageSplits(1000, [
            { userId: 1, percentage: 0 },
            { userId: 2, percentage: 100 },
          ])
        ).toThrow(BalanceEngineError);
        expect(() =>
          calculatePercentageSplits(1000, [
            { userId: 1, percentage: -10 },
            { userId: 2, percentage: 110 },
          ])
        ).toThrow(BalanceEngineError);
        expect(() =>
          calculatePercentageSplits(1000, [
            { userId: 1, percentage: 50 },
            { userId: 1, percentage: 50 },
          ])
        ).toThrow(BalanceEngineError);
        expect(() =>
          calculatePercentageSplits(1000, [
            { userId: 1, percentage: 50, pct: 50 },
            { userId: 2, percentage: 50 },
          ])
        ).toThrow(BalanceEngineError);
      });

      it('rejects percentage that rounds to 0 weight inside sum tolerance with BalanceEngineError', () => {
        expect(() =>
          calculatePercentageSplits(1000, [
            { userId: 1, percentage: 100 },
            { userId: 2, percentage: 1e-7 },
          ])
        ).toThrow(BalanceEngineError);
      });

      it('property test: sum(splits) === total for 1,000 random percentage scenarios', () => {
        for (let seed = 1; seed <= 1000; seed++) {
          const total = (seed * 883) % 400000 + 1;
          const p1 = (seed % 80) + 10; // 10 to 89
          const p2 = 100 - p1;
          const result = calculatePercentageSplits(total, [
            { userId: 1, percentage: p1 },
            { userId: 2, percentage: p2 },
          ]);
          const sum = result.reduce((acc, s) => acc + s.amount, 0);
          expect(sum).toBe(total);
          for (const s of result) {
            expect(Number.isSafeInteger(s.amount)).toBe(true);
            expect(s.amount).toBeGreaterThanOrEqual(0);
          }
        }
      });
    });

    describe('calculateBalances integration with custom splits', () => {
      it('preserves zero-sum conservation and accurate total_spend across unequal splits', () => {
        const summary = calculateBalances(
          [
            {
              id: 1,
              paid_by: 1,
              amount: 6000,
              splits: [
                { user_id: 1, amount: 4000 },
                { user_id: 2, amount: 2000 },
              ],
            },
            {
              id: 2,
              paid_by: 2,
              amount: 3000,
              shares: { 1: 1, 2: 2 },
            },
          ],
          { members: [1, 2] }
        );

        expect(summary.total_spend).toBe(9000);
        // Expense 1: User 1 paid 6000, owes 4000 (net +2000). User 2 owes 2000 (net -2000).
        // Expense 2: User 2 paid 3000, shares 1:2 -> User 1 owes 1000, User 2 owes 2000.
        // Overall: User 1 paid 6000, owes 5000 -> net +1000. User 2 paid 3000, owes 4000 -> net -1000.
        expect(summary.net_balances[1]).toBe(1000);
        expect(summary.net_balances[2]).toBe(-1000);
        const netSum = Object.values(summary.net_balances).reduce((acc, b) => acc + b, 0);
        expect(netSum).toBe(0);

        // Settlements should settle 1000 from user 2 to user 1
        expect(summary.settlements).toEqual([
          {
            from: 2,
            from_user_id: 2,
            to: 1,
            to_user_id: 1,
            amount: 1000,
          },
        ]);
      });

      it('rejects splits in calculateBalances where ratio is present after equal split item', () => {
        expect(() =>
          calculateBalances(
            [
              {
                id: 1,
                paid_by: 1,
                amount: 1000,
                splits: [{ user_id: 1 }, { user_id: 2, ratio: 3 }],
              },
            ],
            { members: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] }
          )
        ).toThrow(BalanceEngineError);
      });
    });
  });
});
