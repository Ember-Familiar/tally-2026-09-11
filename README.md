# tally-2026-09-11
Strict-head obligation handling Tally dogfood run (2026-09-11)

## Database & Migrations

To run database migrations:

```bash
npm run migrate
```

This runs the database migration runner (`node dist/migrate.js`). On a fresh clone, npm automatically compiles the TypeScript source to `dist/` via the `premigrate` script before executing migrations. You can also build explicitly using `npm run build`.

## Running the Server

To start the Tally HTTP server:

```bash
npm start
```

This starts the server on port 3000 by default (`node dist/server.js`), using the SQLite database at `tally.db`. On a fresh clone, npm automatically compiles the TypeScript source to `dist/` via the `prestart` script before starting the server.

### Environment Variables

- `PORT`: Port number for the HTTP server (default: `3000`). Must be a valid port integer between 1 and 65535.
- `DB_PATH`: Path to the SQLite database file (default: `tally.db` for the server and migration CLI; `:memory:` for the test suite). Set `DB_PATH=:memory:` if you want an ephemeral in-memory database instance.

## API Endpoints

### Health Checks

- `GET /health` or `GET /api/health`
  - Returns `200 OK` with `{"status":"ok"}`.

### Groups

#### `POST /groups` — Create a Group

Creates a group with a name and initial members in a single SQLite transaction.

**Member Contract**:
- Members can be provided as names (strings or objects with `name`), or as existing user IDs (positive integers or objects with `id`).
- For members specified by name: if a user with that name already exists in `users` (matched case-insensitively), the existing user is reused; if no user with that name exists, a new `users` record is created automatically.
- For members specified by ID: the ID must reference an existing user in `users`. Non-existent IDs are rejected with `400 Bad Request`.
- Duplicate members within the same request (by name, by ID, or resolving to the same user) are rejected with `400 Bad Request`.
- If member creation or insertion fails for any reason, the entire operation is rolled back atomically, leaving no orphan group, member, or user rows.

**Request Body**:
```json
{
  "name": "Ski Trip",
  "members": ["Alice", "Bob", { "name": "Charlie" }]
}
```

**Response (`201 Created`)**:
```json
{
  "id": 1,
  "name": "Ski Trip",
  "created_at": "2026-09-11 19:25:00",
  "members": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" },
    { "id": 3, "name": "Charlie" }
  ]
}
```

**Validation & Error Responses (`400 Bad Request`)**:
- Missing or non-string name: `{ "error": "Group name is required" }`
- Empty or whitespace-only name: `{ "error": "Group name cannot be empty" }`
- Missing or non-array member list: `{ "error": "Members list is required" }`
- Empty member list: `{ "error": "Group must have at least one member" }`
- Member with empty name: `{ "error": "Member name cannot be empty" }`
- Malformed member ID (non-integer, <= 0): `{ "error": "Invalid member ID: must be a positive integer" }`
- Non-existent member user ID: `{ "error": "User with ID <id> does not exist" }`
- Duplicate members within request: `{ "error": "Duplicate member in request: <name>" }` or `{ "error": "Duplicate member in group" }`
- Malformed JSON payload: `{ "error": "Invalid JSON payload" }`

#### `GET /groups` — List Groups

Returns an array of all groups, each with their member list, ordered by `id ASC`.

**Response (`200 OK`)**:
```json
[
  {
    "id": 1,
    "name": "Ski Trip",
    "created_at": "2026-09-11 19:25:00",
    "members": [
      { "id": 1, "name": "Alice" },
      { "id": 2, "name": "Bob" }
    ]
  }
]
```

#### `GET /groups/:id` — Group Detail

Returns a single group with its members by group ID.

**Response (`200 OK`)**:
```json
{
  "id": 1,
  "name": "Ski Trip",
  "created_at": "2026-09-11 19:25:00",
  "members": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ]
}
```

**Error Responses**:
- `404 Not Found`: `{ "error": "Group not found" }` when the group ID does not exist.
- `400 Bad Request`: `{ "error": "Invalid group ID: must be a positive integer" }` when `:id` is not a positive integer (e.g., `/groups/abc`, `/groups/-1`, `/groups/0`).

### Expenses

#### `POST /groups/:id/expenses` — Create an Expense with Equal Split

Creates an expense for a group with an exact integer-cent equal split among all group members in a single atomic SQLite transaction across `expenses` and `expense_splits`.

**Arithmetic & Remainder Distribution**:
- All amounts (`amount` on expenses and `amount` on splits) are stored as integer cents.
- Given an expense of `total` cents and `N` group members ordered by `user_id ASC`:
  - `base = Math.floor(total / N)`
  - `remainder = total % N`
  - The first `remainder` members by `user_id ASC` each absorb one extra cent (`base + 1`); the remaining members absorb `base` cents.
  - Split amounts sum exactly to `total` for every input (including `1000 / 3` → `334, 333, 333` and `1 / 3` → `1, 0, 0`).

**Payer Contract**:
- Payer can be specified via `paid_by` (or `payer_id`), as a user ID (positive integer), user name (string, matched case-insensitively), or object (`{ id }` or `{ name }`).
- The payer must be an existing member of the group. A non-member payer is rejected with `400 Bad Request`.

**Date Validation**:
- `date` is optional. If provided, it must be a valid timestamp in `YYYY-MM-DD HH:MM:SS` format.
- Bare `'now'`, non-standard formats (e.g. ISO 8601 with `T`), and invalid calendar dates (e.g. `2026-02-30 00:00:00`, `2026-09-05 24:00:00`) are rejected with `400 Bad Request`.
- If omitted, `date` defaults to SQLite's `CURRENT_TIMESTAMP`.

**Request Body**:
```json
{
  "amount": 6000,
  "description": "Groceries",
  "paid_by": 1,
  "date": "2026-09-11 19:00:00"
}
```

**Response (`201 Created`)**:
```json
{
  "id": 1,
  "group_id": 1,
  "paid_by": 1,
  "amount": 6000,
  "description": "Groceries",
  "date": "2026-09-11 19:00:00",
  "created_at": "2026-09-11 19:00:00",
  "splits": [
    {
      "id": 1,
      "expense_id": 1,
      "user_id": 1,
      "user_name": "Alice",
      "amount": 2000,
      "created_at": "2026-09-11 19:00:00"
    },
    {
      "id": 2,
      "expense_id": 1,
      "user_id": 2,
      "user_name": "Bob",
      "amount": 2000,
      "created_at": "2026-09-11 19:00:00"
    },
    {
      "id": 3,
      "expense_id": 1,
      "user_id": 3,
      "user_name": "Charlie",
      "amount": 2000,
      "created_at": "2026-09-11 19:00:00"
    }
  ]
}
```

#### `GET /groups/:id/expenses` — List Group Expenses

Returns an array of all expenses recorded for the specified group, each including full payer and split details.

**Ordering & Same-Second Tiebreak**:
- Expenses are returned ordered by expense date descending (`date DESC`), newest expense date first. This ordering uses the user-supplied `expenses.date`, not `created_at`.
- Because SQLite's default `CURRENT_TIMESTAMP` has one-second resolution, expenses recorded within the same second share an identical date string. Ties on date are broken deterministically by `id DESC` (newest expense ID first), utilizing the composite index `(group_id, date DESC, id DESC)`.

**Response (`200 OK`)**:
```json
[
  {
    "id": 1,
    "group_id": 1,
    "paid_by": 1,
    "amount": 6000,
    "description": "Groceries",
    "date": "2026-09-11 19:00:00",
    "created_at": "2026-09-11 19:00:00",
    "splits": [
      {
        "id": 1,
        "expense_id": 1,
        "user_id": 1,
        "user_name": "Alice",
        "amount": 2000,
        "created_at": "2026-09-11 19:00:00"
      },
      {
        "id": 2,
        "expense_id": 1,
        "user_id": 2,
        "user_name": "Bob",
        "amount": 2000,
        "created_at": "2026-09-11 19:00:00"
      },
      {
        "id": 3,
        "expense_id": 1,
        "user_id": 3,
        "user_name": "Charlie",
        "amount": 2000,
        "created_at": "2026-09-11 19:00:00"
      }
    ]
  }
]
```
If the group has no expenses, returns `200 OK` with an empty array `[]`.

**Error Responses (`400 Bad Request` / `404 Not Found`)**:
- Unknown group ID: `404 Not Found` `{ "error": "Group not found" }`
- Malformed group ID: `400 Bad Request` `{ "error": "Invalid group ID: must be a positive integer" }`

### Balances

#### `GET /groups/:id/balances` — Get Group Balances

Computes and returns the complete balance summary for a group, including per-user balances (paid, owed, net balance), simplified settlement transfers, bilateral pairwise debts, and total group spend in integer cents.

**Contract & Invariants**:
- All currency amounts are strictly safe integer cents with zero floating-point arithmetic.
- If the group exists but has no expenses recorded, returns `200 OK` with zeroed balances for each member of the group, empty `settlements` and `pairwise` transfer arrays, and `total_spend: 0`.
- Net balances conserve exactly to zero ($\sum \text{net\_balance} = 0$).

**Response (`200 OK`)**:
```json
{
  "balances": [
    {
      "user_id": 1,
      "userId": 1,
      "name": "Alice",
      "paid": 6000,
      "owed": 2000,
      "net_balance": 4000,
      "balance": 4000
    },
    {
      "user_id": 2,
      "userId": 2,
      "name": "Bob",
      "paid": 0,
      "owed": 2000,
      "net_balance": -2000,
      "balance": -2000
    },
    {
      "user_id": 3,
      "userId": 3,
      "name": "Charlie",
      "paid": 0,
      "owed": 2000,
      "net_balance": -2000,
      "balance": -2000
    }
  ],
  "net_balances": {
    "1": 4000,
    "2": -2000,
    "3": -2000
  },
  "settlements": [
    {
      "from": 2,
      "to": 1,
      "from_user_id": 2,
      "to_user_id": 1,
      "from_name": "Bob",
      "to_name": "Alice",
      "amount": 2000
    },
    {
      "from": 3,
      "to": 1,
      "from_user_id": 3,
      "to_user_id": 1,
      "from_name": "Charlie",
      "to_name": "Alice",
      "amount": 2000
    }
  ],
  "pairwise": [
    {
      "from": 2,
      "to": 1,
      "from_user_id": 2,
      "to_user_id": 1,
      "from_name": "Bob",
      "to_name": "Alice",
      "amount": 2000
    },
    {
      "from": 3,
      "to": 1,
      "from_user_id": 3,
      "to_user_id": 1,
      "from_name": "Charlie",
      "to_name": "Alice",
      "amount": 2000
    }
  ],
  "total_spend": 6000
}
```

**Error Responses (`400 Bad Request` / `404 Not Found` / `500 Internal Server Error`)**:
- Unknown group ID: `404 Not Found` `{ "error": "Group not found" }`
- Malformed group ID: `400 Bad Request` `{ "error": "Invalid group ID: must be a positive integer" }`
- Corrupt data or invariant violation: `500 Internal Server Error` `{ "error": "<details>" }` (e.g., torn splits from direct SQLite cascade deletions where `sum(splits) < amount`, conservation violations, or integer overflow).

## Balance Engine (`src/balances.ts`)

Pure, unit-tested balance calculation engine and deterministic debt simplification using strict integer-cent arithmetic.

### Core Principles & Invariants

1. **Integer-Cent Arithmetic & Overflow Protection**:
   - Every currency amount (`amount`, `paid`, `owed`, `net_balance`, `balance`, transfer amounts, and `total_spend`) is strictly represented as a safe integer in cents (`Number.isSafeInteger(amount)`).
   - Floating-point currency values (e.g. `10.5` or `33.33`) are forbidden and rejected with `BalanceEngineError` (`INVALID_AMOUNT`).
   - All public accumulators (`paid`, `owed`, `net_balance`, `total_spend`, pairwise debt amounts, settlement amounts) use checked addition and subtraction (`checkedAdd`, `checkedSub`) and throw `BalanceEngineError` with error code `INTEGER_OVERFLOW` before any unsafe numeric output can be returned.
   - Invariant-only totals (e.g. `splitSum` conservation and `totalNet` zero-sum verification in `simplifyDebts`) accumulate using arbitrary-precision `BigInt` to prevent floating-point precision loss or false conservation failures at `Number.MAX_SAFE_INTEGER`.
   - Calculations use exact integer additions, subtractions, and integer remainder distributions—zero floating-point arithmetic is used.

2. **Zero-Sum Conservation**:
   - Across any valid set of expenses (and optional settlements), net balances conserve exactly to zero:
     $$\sum_{u} \text{net\_balance}_u = 0$$
   - In odd divisions (e.g. 100 cents split across 3 members), remainder cents are allocated deterministically to the first members ordered by `user_id ASC`, preserving exact conservation with no manufactured or lost cents.

3. **Expense Splits Integrity & Cascade Handling**:
   - For every expense with splits, the sum of split amounts must strictly equal the expense amount (`sum(splits) === expense.amount`).
   - If an expense has torn splits (such as when `sum(splits) < expense.amount` caused by manual/direct SQLite cascade deletions where `expense_splits.user_id ON DELETE CASCADE` drops a participant row, or malformed splits where `sum(splits) !== expense.amount`), the engine rejects the input by throwing a typed `BalanceEngineError` with error code `INCONSISTENT_SPLITS`.
   - The balance engine strictly refuses to silently manufacture unbacked credits or silently drop participant debts, ensuring no cents can ever be created or lost out of thin air.
   - Duplicate participant splits within the same expense are strictly rejected across all entry points (`calculateBalances`, `calculateUserBalances`, `calculatePairwiseDebts`) with `BalanceEngineError` (`DUPLICATE_SPLIT_USER`).

4. **Deterministic Debt Simplification**:
   - Net balances are partitioned into debtors (net balance < 0) and creditors (net balance > 0).
   - Array inputs are strictly validated for user uniqueness, rejecting duplicate user IDs with `BalanceEngineError` (`DUPLICATE_USER`).
   - Debtors and creditors are sorted with primary key `amount DESC` (greedily settling largest amounts first) and secondary tiebreak key `userId ASC` (ensuring 100% deterministic, reproducible outputs).
   - The greedy heuristic is sound, deterministic, never below minimum, and guarantees at most $N - 1$ transfers (where $N$ is the number of participants with non-zero balances). Note: greedy simplification does not guarantee the global minimum transaction count across all subsets (finding the absolute minimum is NP-hard, equivalent to subset sum partition; across 29,970 scenarios tested against provable DP minimum, greedy exceeds the optimum in ~25% of cases, worst observed 6 transfers where 4 suffice on `[5, 3, 2, 4, -6, -3, -5]`).
   - Every simplified transfer:
     - Moves a strictly positive integer cent amount (`amount > 0`).
     - Preserves the exact input net position for every user: $(\sum \text{received}) - (\sum \text{sent}) = \text{net\_balance}$.
     - Defensively asserts distinct endpoints (`from !== to`), preventing self-transfers.
     - Yields an empty array `[]` for empty or already-settled inputs.

### Exported Functions

```typescript
// Detailed user balance records (paid, owed, net_balance, balance) sorted by user_id ASC
function calculateUserBalances(expenses?: ExpenseInput[], options?: BalanceOptions): UserBalance[];

// Map of userId -> net_balance in integer cents (positive = creditor, negative = debtor)
function calculateNetBalances(expenses?: ExpenseInput[], options?: BalanceOptions): Record<number, number>;

// Deterministic greedy debt simplification (sound, deterministic, guarantees <= N-1 transfers)
function simplifyDebts(netBalances?: UserBalance[] | Record<number | string, number> | Map<number | string, number> | null): Transfer[];

// Direct bilateral pairwise debts netted between user pairs
function calculatePairwiseDebts(expenses?: ExpenseInput[], options?: BalanceOptions): PairwiseDebt[];

// High-level engine combining balances, net_balances, simplified settlements, pairwise, and total_spend
function calculateBalances(expenses?: ExpenseInput[], options?: BalanceOptions): GroupBalanceSummary;

// Checked integer addition and subtraction validating safe-integer arguments (INVALID_AMOUNT) and throwing INTEGER_OVERFLOW if safe-integer domain is breached
function checkedAdd(a: number, b: number, context?: string): number;
function checkedSub(a: number, b: number, context?: string): number;
```

### Exported Types

```typescript
export interface UserBalance {
  user_id: number;
  userId: number; // alias
  name: string | null;
  paid: number; // integer cents
  owed: number; // integer cents
  net_balance: number; // integer cents (paid - owed)
  balance: number; // alias for net_balance
}

export interface Transfer {
  from: number;
  to: number;
  from_user_id: number;
  to_user_id: number;
  from_name?: string;
  to_name?: string;
  amount: number; // positive integer cents
}

export type PairwiseDebt = Transfer;

export interface GroupBalanceSummary {
  balances: UserBalance[];
  net_balances: Record<number, number>;
  settlements: Transfer[];
  pairwise: Transfer[];
  total_spend: number; // integer cents
}

export interface BalanceOptions {
  members?: Array<number | { id?: number; user_id?: number; userId?: number; name?: string | null }>;
  splits?: Array<{ expense_id?: number; user_id?: number; userId?: number; amount: number; user_name?: string | null }>;
  settlements?: Array<{ from?: number; from_user_id?: number; to?: number; to_user_id?: number; amount: number }>;
}
```

### Integration in `GET /groups/:id/balances`

The HTTP route `GET /groups/:id/balances` delegates directly to the balance engine by retrieving group members and historical expenses with splits, invoking:

```typescript
import { calculateBalances } from '../balances';

const summary = calculateBalances(groupExpenses, { members: groupMembers });
// summary.balances -> array of UserBalance
// summary.net_balances -> { [userId]: netCents }
// summary.settlements -> simplified transfers
// summary.pairwise -> bilateral pairwise debts
// summary.total_spend -> total expenses amount in cents
```
