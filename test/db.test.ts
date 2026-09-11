import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { createDatabase } from '../src/db';

describe('Database', () => {
  it('creates an in-memory SQLite database instance with foreign keys enabled', () => {
    const db = createDatabase(':memory:');
    const fkRow = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
    expect(fkRow.foreign_keys).toBe(1);

    db.exec('CREATE TABLE test_items (id INTEGER PRIMARY KEY, name TEXT);');
    const insertStmt = db.prepare('INSERT INTO test_items (name) VALUES (?);');
    const info = insertStmt.run('Item A');
    expect(info.changes).toBe(1);

    const selectStmt = db.prepare('SELECT * FROM test_items WHERE name = ?;');
    const row = selectStmt.get('Item A') as { id: number; name: string };
    expect(row.name).toBe('Item A');

    db.close();
  });

  it('enables WAL mode and foreign keys on a file-backed database', () => {
    const tempDbPath = path.join(os.tmpdir(), `tally-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      const db = createDatabase(tempDbPath);
      const fkRow = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
      expect(fkRow.foreign_keys).toBe(1);

      const journalRow = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
      expect(journalRow.journal_mode).toBe('wal');

      db.close();
    } finally {
      for (const ext of ['', '-wal', '-shm']) {
        if (fs.existsSync(tempDbPath + ext)) {
          fs.unlinkSync(tempDbPath + ext);
        }
      }
    }
  });
});
