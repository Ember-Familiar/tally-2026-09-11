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
