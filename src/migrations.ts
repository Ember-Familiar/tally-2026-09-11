import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export function runMigrations(db: Database.Database, migrationsDir?: string): string[] {
  const dir = migrationsDir || path.resolve(__dirname, '../migrations');

  // Ensure migration tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Query already applied migrations
  const appliedRows = db.prepare('SELECT name FROM schema_migrations;').all() as { name: string }[];
  const appliedNames = new Set(appliedRows.map((r) => r.name));

  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const matchA = a.match(/^(\d+)/);
      const matchB = b.match(/^(\d+)/);
      if (matchA && matchB) {
        const numA = parseInt(matchA[1], 10);
        const numB = parseInt(matchB[1], 10);
        if (numA !== numB) return numA - numB;
      }
      return a.localeCompare(b);
    });

  const newlyApplied: string[] = [];
  const applyMigration = db.transaction((sql: string, file: string) => {
    db.exec(sql);
    const insertStmt = db.prepare('INSERT INTO schema_migrations (name) VALUES (?);');
    insertStmt.run(file);
  });

  for (const file of files) {
    if (!appliedNames.has(file)) {
      const filePath = path.join(dir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      try {
        applyMigration(sql, file);
        newlyApplied.push(file);
      } catch (err) {
        throw new Error(`Failed to apply migration ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return newlyApplied;
}
