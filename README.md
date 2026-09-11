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

## Web UI

Tally includes a browser interface served at `/` when navigating with a web browser (or requesting `Accept: text/html`). Static assets (`index.html`, `style.css`, `app.js`) reside in the root `public/` directory and are served by the Express backend.

The interface provides:
- **Group Management**: Create new groups with initial members and view all existing groups with member badges and creation dates.
- **Add-Expense Form**: Record new shared expenses against `POST /groups/:id/expenses` with description, integer-cent amount, payer (name or ID), and optional custom timestamp, split equally across group members.
- **Expense History**: View recorded expenses for any group via `GET /groups/:id/expenses` ordered newest expense date first (`date DESC, id DESC`), complete with formatted dollar amounts, payer information, date, and individual split allocations.
- **Balances View**: View per-member net positions (paid, owed, and net balance) alongside simplified settlement suggestions via `GET /groups/:id/balances`, with currency amounts formatted from integer cents via `formatCents`.
- **Settle-Up Action**: Record direct debt repayments between group members via `POST /groups/:id/settle` with inline validation feedback and automatic balances reload without page refresh. Also supports one-click prefill directly from settlement suggestion cards.
- **Feedback & Validation**: Inline feedback banners for success notifications and server-rejected validation error messages (e.g. missing amount, non-member payer, invalid dates).
- **Safe DOM Discipline**: All dynamic UI nodes are generated using safe DOM primitives (`document.createElement`, `element.textContent`, `element.appendChild`, `element.replaceChildren`), strictly forbidding unsafe sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`) to guarantee complete immunity from script/markup injection.

## API Endpoints

### Health Checks

- `GET /health` or `GET /api/health`
  - Returns `200 OK` with `{"status":"ok"}`.

### Validation & Error Handling Contract

All endpoints adhere to a uniform JSON error contract. Error responses always return a JSON object containing a typed `error` string:

```json
{
  "error": "Descriptive error message"
}
```

#### Status Code Conventions:
- **`400 Bad Request`**: Returned for all client input validation errors:
  - Missing required fields (e.g. `name`, `amount`, `paid_by`).
  - Malformed or non-canonical identifiers: IDs in URLs and payloads must be strictly canonical positive decimal integers (`1`, `2`, ...). Non-canonical strings with leading zeros (e.g. `01`, `007`) or invalid formats are rejected (`Invalid group ID: must be a positive integer`).
  - Invalid amounts: amounts must be safe positive integers in integer cents (`amount > 0`). Floating-point numbers, negative values, and zero are rejected.
  - Participant membership: payers, payees, and split participants must be members of the group. Name lookups are scoped strictly to group members.
  - Contradictory split specifications: supplying split values alongside `split_type: "equal"` is rejected (`Invalid split specification: unexpected split values for equal split`) across both object and array payload formats.
  - Strict type validation: `null` is rejected for fields expecting strings or objects (e.g. `split_type: null` returns `split_type must be a string`).
  - Malformed JSON payloads return `{ "error": "Invalid JSON payload" }`.
  - Malformed bodies, decompressor failures, or invalid encoding headers return `{ "error": "Bad request" }`.
- **`404 Not Found`**:
  - Missing resources return `{ "error": "Group not found" }`.
  - Unmatched routes and path-traversal normalizations (e.g. `/groups/../expenses`) return `{ "error": "Not found" }`.
- **`413 Payload Too Large`**:
  - Payloads exceeding body parser size limits return `{ "error": "Payload too large" }`. Absolute filesystem paths and internal stack traces are completely suppressed.
- **`415 Unsupported Media Type`**:
  - Unsupported content encodings (e.g. `Content-Encoding: br-nope`) return `{ "error": "Unsupported media type" }`.
- **`500 Internal Server Error`**:
  - Unexpected internal server errors, database failures, and persistent data corruption invariant violations return `{ "error": "Internal server error" }` without leaking stack traces, source paths, or internal row/check details to clients.

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
- `400 Bad Request`: `{ "error": "Invalid group ID: must be a positive integer" }` when `:id` is not a strictly canonical positive integer (e.g., `/groups/abc`, `/groups/-1`, `/groups/0`, `/groups/01`).

### Expenses

#### `POST /groups/:id/expenses` — Create an Expense (Equal or Custom Splits)

Creates an expense for a group with an exact integer-cent split among specified participants (or an equal split across all group members if omitted) in a single atomic SQLite transaction across `expenses` and `expense_splits`.

**Default Equal Split**:
- When no split parameters are provided, the expense is split equally among all members of the group.
- Given `total` cents and `N` members ordered by `user_id ASC`:
  - `base = Math.floor(total / N)`
  - `remainder = total % N`
  - The first `remainder` members by `user_id ASC` each absorb one extra cent (`base + 1`); remaining members absorb `base` cents.
  - Split amounts always sum exactly to `total`.

**Custom Splits**:
Callers may specify custom splits using one of three modes:
1. **Explicit Amounts**: Exact integer-cent amounts per member.
   - Array format: `splits: [{ user_id: 1, amount: 4000 }, { user_id: 2, amount: 2000 }]`
   - Object format: `splits: { "1": 4000, "2": 2000 }` or `split_amounts: { "Alice": 4000, "Bob": 2000 }`
   - Sum of split amounts must equal expense `amount` exactly.
2. **Ratios / Shares**: Relative proportions distributed using the deterministic largest remainder method.
   - Array format: `splits: [{ user_id: 1, ratio: 2 }, { user_id: 2, ratio: 1 }]` or `shares: [{ user_id: 1, shares: 2 }, ...]`
   - Object format: `shares: { "1": 2, "2": 1 }` or `ratios: { "Alice": 2, "Bob": 1 }`
   - Deterministic remainder allocation: remainder cents are allocated to participants with the largest fractional remainder. Ties are broken deterministically by `user_id ASC`.
3. **Percentages**: Percentage shares distributed using the deterministic largest remainder method.
   - Array format: `splits: [{ user_id: 1, percentage: 60 }, { user_id: 2, percentage: 40 }]`
   - Object format: `percentages: { "1": 60, "2": 40 }` or `percentages: { "Alice": 50, "Bob": 50 }`
   - Percentages must sum to 100 exactly (e.g. `50` + `50`, or `33.33` + `33.33` + `33.34`).
   - Remainder cents allocated to largest fractional remainder; ties broken by `user_id ASC`.
4. **Equal Subsets**: Equal split among a specified subset of members.
   - `splits: [1, 2]` (array of user IDs or names) with `split_type: "equal"` or omitted.
   - Splits are calculated equally among only the specified members; omitted group members owe 0 cents.

**Participant Resolution & Aliases**:
- Participants can be identified in split objects by: `user_id`, `userId`, `user`, `member_id`, `member`, `id`, or `name` (matched case-insensitively).
- In object maps (e.g. `{ "1": 3000 }` or `{ "Alice": 3000 }`), keys are parsed as numeric user IDs if positive integers, or as user names.
- All participants must be existing members of the group.

**Split Value Properties & Ambiguity**:
- In split items (array format), callers specify a split value using amount keys (`amount`, `split_amount`), ratio keys (`ratio`, `shares`, `weight`), or percentage keys (`percentage`, `percent`, `pct`).
- The item vocabulary is closed: split item objects may only carry participant aliases (`user_id`, `userId`, `user`, `member_id`, `member`, `id`, `name`) and recognized value keys (`amount`, `split_amount`, `ratio`, `shares`, `weight`, `percentage`, `percent`, `pct`). Unrecognized or misspelled properties (e.g. `ratios`, `share`, `percentages`, `amounts`) are rejected with `400 Bad Request` (`Unknown property '...' in split item`). Equal-subset items carrying only a participant alias (e.g. `[{ userId: 1 }, { userId: 2 }]`) are valid and calculate an equal split across those members.
- At most one split value property may be provided per item. Specifying multiple value properties—whether across different categories (e.g. `amount` and `ratio`) or within the same category (e.g. `ratio` and `shares`, `amount` and `split_amount`, `percentage` and `pct`)—is ambiguous and rejected with `400 Bad Request` (`Ambiguous split specification in split item`).
- Top-level split vocabulary: split item value keys (`ratio`, `share`, `weight`, `percentage`, `percent`, `pct`, `split_amount`) are rejected at the top level with `400 Bad Request` (`Unrecognized split property '...' at top level`), whether specified alone or alongside valid split properties. Unrelated metadata properties (`notes`, `currency`, `category`, `receipt_url`) remain permitted.

**Payer Contract**:
- Payer can be specified via `paid_by` (or `payer_id`, `payer`), as a user ID (positive integer), user name (string, matched case-insensitively against group members), or object (`{ id }` or `{ name }`).
- Alias precedence: if multiple aliases are provided in a request, precedence is:
  - Expense payer: `paid_by` > `payer_id` > `payer`
  - Settlement debtor (`from`): `from` > `from_user_id` > `paid_by` > `payer_id` > `payer`
  - Settlement creditor (`to`): `to` > `to_user_id` > `paid_to` > `payee_id` > `payee` > `received_by`
  - Split participants: `user_id` > `userId` > `user` > `member_id` > `member` > `id` > `name`
- The payer must be an existing member of the group. Name matching is scoped to the group's members, ensuring duplicate user names across different groups resolve correctly. A non-member payer is rejected with `400 Bad Request`.

**Date Validation**:
- `date` is optional. If provided, it must be a valid timestamp in `YYYY-MM-DD HH:MM:SS` format.
- Bare `'now'`, non-standard formats (e.g. ISO 8601 with `T`), and invalid calendar dates are rejected with `400 Bad Request`.
- If omitted, `date` defaults to SQLite's `CURRENT_TIMESTAMP`.

**Request Body Examples**:
```json
// Equal split default
{
  "amount": 6000,
  "description": "Groceries",
  "paid_by": 1
}

// Explicit amounts
{
  "amount": 6000,
  "description": "Dinner",
  "paid_by": "Alice",
  "splits": [
    { "user_id": 1, "amount": 4000 },
    { "user_id": 2, "amount": 2000 }
  ]
}

// Ratios / Shares
{
  "amount": 1000,
  "description": "Cabin rental",
  "paid_by": 1,
  "shares": {
    "Alice": 2,
    "Bob": 1
  }
}

// Percentages
{
  "amount": 5000,
  "description": "Utilities",
  "paid_by": 2,
  "percentages": {
    "Alice": 60,
    "Bob": 40
  }
}
```

**Response (`201 Created`)**:
```json
{
  "id": 1,
  "group_id": 1,
  "paid_by": 1,
  "amount": 6000,
  "description": "Dinner",
  "date": "2026-09-11 19:00:00",
  "created_at": "2026-09-11 19:00:00",
  "splits": [
    {
      "id": 1,
      "expense_id": 1,
      "user_id": 1,
      "user_name": "Alice",
      "amount": 4000,
      "created_at": "2026-09-11 19:00:00"
    },
    {
      "id": 2,
      "expense_id": 1,
      "user_id": 2,
      "user_name": "Bob",
      "amount": 2000,
      "created_at": "2026-09-11 19:00:00"
    }
  ]
}
```

**Validation & Error Responses (`400 Bad Request` / `404 Not Found`)**:
- Unknown group ID: `404 Not Found` `{ "error": "Group not found" }`
- Malformed group ID: `400 Bad Request` `{ "error": "Invalid group ID: must be a positive integer" }`
- Missing or invalid amount (<= 0, float, non-integer): `400 Bad Request` `{ "error": "Amount must be a positive integer in cents" }`
- Missing payer: `400 Bad Request` `{ "error": "Payer is required" }`
- Payer not a member of group: `400 Bad Request` `{ "error": "Payer must be a member of the group" }`
- Participant not a member of group: `400 Bad Request` `{ "error": "Participant must be a member of the group" }`
- Duplicate participant in splits: `400 Bad Request` `{ "error": "Duplicate participant in splits" }`
- Empty split set: `400 Bad Request` `{ "error": "Splits list cannot be empty" }`
- Non-positive or invalid split amount: `400 Bad Request` `{ "error": "Split amount must be a positive integer in cents" }`
- Split amounts sum mismatch: `400 Bad Request` `{ "error": "Split amounts sum (...) does not equal total amount (...)" }`
- Non-positive ratio: `400 Bad Request` `{ "error": "Split ratio must be a positive number" }`
- Percentages do not sum to 100: `400 Bad Request` `{ "error": "Split percentages must sum to 100" }`
- Non-positive percentage: `400 Bad Request` `{ "error": "Split percentage must be positive" }`
- Ambiguous split specifications: `400 Bad Request` `{ "error": "Ambiguous split specification: multiple split properties provided" }`
- Ambiguous split item: `400 Bad Request` `{ "error": "Ambiguous split specification in split item" }`
- Unrecognized or misspelled property on split item: `400 Bad Request` `{ "error": "Unknown property '...' in split item" }`
- Unrecognized split property at top level: `400 Bad Request` `{ "error": "Unrecognized split property '...' at top level" }`
- Mixed split items: `400 Bad Request` `{ "error": "Mixed split specification: cannot mix amounts, ratios, and percentages" }`
- Split type mismatch: `400 Bad Request` `{ "error": "Invalid split specification: expected ..." }`
- Split values provided with equal split_type: `400 Bad Request` `{ "error": "Invalid split specification: unexpected split values for equal split" }`
- Non-string or null split_type: `400 Bad Request` `{ "error": "split_type must be a string" }`
- Unsupported split type: `400 Bad Request` `{ "error": "Unsupported split_type: ..." }`
- Invalid date format: `400 Bad Request` `{ "error": "Invalid date format: must be YYYY-MM-DD HH:MM:SS" }`
- Malformed JSON payload: `400 Bad Request` `{ "error": "Invalid JSON payload" }`

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
- Corrupt data or invariant violation: `500 Internal Server Error` `{ "error": "Internal server error" }` (e.g., non-member settlement participant, torn splits from direct SQLite cascade deletions where `sum(splits) < amount`, conservation violations, or integer overflow).

### Settlements

**Settlement Group-Membership Invariant**:
- Every settlement recorded or queried for a group must involve only current members of that group (`from_user_id` and `to_user_id` must be members of `group_id`).
- This invariant is strictly enforced on writes (`POST /groups/:id/settle`, rejecting non-members with `400 Bad Request`).
- The invariant is guarded across all read endpoints (`GET /groups/:id/balances` and `GET /groups/:id/settlements`). If an out-of-band database insert or database corruption introduces a settlement referencing a non-member, both endpoints fail closed with `500 Internal Server Error` (`{ "error": "Internal server error" }`), ensuring corrupted data is never accounted for or enumerated to clients as valid group transactions.
- Because there is no repair endpoint, a single corrupt row permanently 500s both `/balances` and `/settlements` for that group, and recovery is an out-of-band SQL/DBA operation.

#### `POST /groups/:id/settle` — Record a Settlement (Debt Repayment)

Records a debt repayment from one group member (`from` / payer) to another (`to` / payee). Settlements flow directly through to `GET /groups/:id/balances` using the pure balance engine's `options.settlements` path.

**Contract & Invariants**:
- Both parties must be members of the group.
- A member cannot settle with themselves (`from !== to`).
- Amount must be a positive safe integer in cents (`amount > 0`). Float amounts, strings, zero, and negative values are strictly rejected.
- Recorded settlements reduce bilateral debts in `pairwise` and net balances in `balances`, while preserving zero-sum conservation ($\sum \text{net\_balance} = 0$).
- Settlements do not increase `total_spend` (group spend represents true expenditures).

**Request Body (`POST /groups/:id/settle`)**:
```json
{
  "from": 2,
  "to": 1,
  "amount": 2000,
  "description": "Cabin fee repayment",
  "date": "2026-09-05 20:00:00"
}
```

Aliases accepted for `from` and `to`:
- `from`: `from`, `from_user_id`, `paid_by`, `payer_id`, `payer` (by ID number, case-insensitive user name string, or `{ id }` / `{ name }` object).
- `to`: `to`, `to_user_id`, `paid_to`, `payee_id`, `payee`, `received_by` (by ID number, case-insensitive user name string, or `{ id }` / `{ name }` object).
- `description` (optional, default `""`), `date` (optional `YYYY-MM-DD HH:MM:SS`, default SQLite `CURRENT_TIMESTAMP`).

**Response (`201 Created`)**:
```json
{
  "id": 1,
  "group_id": 1,
  "from": 2,
  "to": 1,
  "from_user_id": 2,
  "to_user_id": 1,
  "from_name": "Bob",
  "to_name": "Alice",
  "amount": 2000,
  "description": "Cabin fee repayment",
  "date": "2026-09-05 20:00:00",
  "created_at": "2026-09-05 20:00:00"
}
```

**Error Responses (`400 Bad Request` / `404 Not Found`)**:
- Unknown group ID: `404 Not Found` `{ "error": "Group not found" }`
- Malformed group ID: `400 Bad Request` `{ "error": "Invalid group ID: must be a positive integer" }`
- Missing or invalid amount: `400 Bad Request` `{ "error": "Amount must be a positive integer in cents" }`
- Missing payer / payee: `400 Bad Request` `{ "error": "Payer is required" }` / `{ "error": "Payee is required" }`
- Payer or payee not in group: `400 Bad Request` `{ "error": "Payer must be a member of the group" }` / `{ "error": "Payee must be a member of the group" }`
- Self-settlement: `400 Bad Request` `{ "error": "Cannot settle with self" }`
- Invalid date format: `400 Bad Request` `{ "error": "Invalid date format: must be YYYY-MM-DD HH:MM:SS" }`

#### `GET /groups/:id/settlements` — List Group Settlements

Returns an array of all settlements recorded for the specified group, ordered by `date DESC, id DESC` (newest first). Returns `[]` if no settlements exist for the group.

**Ordering & Determinism**:
- Settlements are ordered chronologically descending by settlement `date DESC`.
- Same-second ties are broken deterministically by `id DESC` (newest settlement ID first), matching the index `(group_id, date DESC, id DESC)`.

**Response (`200 OK`)**:
```json
[
  {
    "id": 1,
    "group_id": 1,
    "from": 2,
    "to": 1,
    "from_user_id": 2,
    "to_user_id": 1,
    "from_name": "Bob",
    "to_name": "Alice",
    "amount": 2500,
    "description": "Repaying dinner",
    "date": "2026-09-11 20:00:00",
    "created_at": "2026-09-11 20:00:00"
  }
]
```

**Error Responses (`400 Bad Request` / `404 Not Found` / `500 Internal Server Error`)**:
- Unknown group ID: `404 Not Found` `{ "error": "Group not found" }`
- Malformed group ID: `400 Bad Request` `{ "error": "Invalid group ID: must be a positive integer" }`
- Corrupt settlement data / non-member participant: `500 Internal Server Error` `{ "error": "Internal server error" }`

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

// Pure split calculation functions using exact integer cents and deterministic largest remainder distribution
function calculateExactSplits(totalAmount: number, splits: ExactSplitItem[]): CalculatedSplit[];
function calculateRatioSplits(totalAmount: number, ratios: RatioSplitItem[]): CalculatedSplit[];
function calculatePercentageSplits(totalAmount: number, percentages: PercentageSplitItem[]): CalculatedSplit[];

// Checked integer addition and subtraction validating safe-integer arguments (INVALID_AMOUNT) and throwing INTEGER_OVERFLOW if safe-integer domain is breached
function checkedAdd(a: number, b: number, context?: string): number;
function checkedSub(a: number, b: number, context?: string): number;
```

### Exported Types

```typescript
export interface CalculatedSplit {
  userId: number;
  amount: number; // integer cents
  name?: string | null;
}

export interface ExactSplitItem {
  user_id?: number;
  userId?: number;
  amount: number; // integer cents
  name?: string | null;
}

export interface RatioSplitItem {
  user_id?: number;
  userId?: number;
  ratio?: number; // positive number
  shares?: number;
  weight?: number;
  name?: string | null;
}

export interface PercentageSplitItem {
  user_id?: number;
  userId?: number;
  percentage?: number; // positive number, sum must equal 100
  percent?: number;
  pct?: number;
  name?: string | null;
}

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
