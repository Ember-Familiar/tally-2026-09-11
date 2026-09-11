import { Express } from 'express';
import Database from 'better-sqlite3';
import { createApp } from './app';
import { createDatabase } from './db';

export const DEFAULT_DB_PATH = 'tally.db';

export function resolveDbPath(rawDbPath: string | undefined): string {
  return rawDbPath || DEFAULT_DB_PATH;
}

export function parsePort(rawPort: string | undefined): number {
  const portStr = rawPort || '3000';
  const port = Number(portStr);
  if (!/^\d+$/.test(portStr) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT environment variable: ${portStr}`);
  }
  return port;
}

export function createServer(dbPath: string = resolveDbPath(process.env.DB_PATH)): { app: Express; db: Database.Database } {
  const db = createDatabase(dbPath);
  const app = createApp(db);
  return { app, db };
}

if (require.main === module) {
  const PORT = parsePort(process.env.PORT);
  const dbPath = resolveDbPath(process.env.DB_PATH);
  const { app } = createServer(dbPath);
  app.listen(PORT, () => {
    console.log(`Tally server listening on port ${PORT} (database: ${dbPath})`);
  });
}
