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
