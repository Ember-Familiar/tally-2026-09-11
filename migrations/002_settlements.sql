-- Settlements table (direct debt repayments between group members)
CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
  description TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (date IS strftime('%Y-%m-%d %H:%M:%S', date)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (from_user_id != to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_settlements_group_id ON settlements(group_id);
CREATE INDEX IF NOT EXISTS idx_settlements_from_user_id ON settlements(from_user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_to_user_id ON settlements(to_user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_group_id_date_id ON settlements(group_id, date DESC, id DESC);
