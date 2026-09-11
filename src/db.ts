import Database from 'better-sqlite3';
import { runMigrations } from './migrations';

export interface DatabaseOptions {
  autoMigrate?: boolean;
  migrationsDir?: string;
}

export function createDatabase(
  dbPath: string = process.env.DB_PATH || ':memory:',
  options: DatabaseOptions = {}
): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  if (options.autoMigrate !== false) {
    runMigrations(db, options.migrationsDir);
  }

  return db;
}
