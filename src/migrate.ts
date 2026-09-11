import { createDatabase } from './db';
import { runMigrations } from './migrations';

export function runCliMigrations(dbPath?: string, migrationsDir?: string): string[] {
  const targetDbPath = dbPath || process.env.DB_PATH || 'tally.db';
  console.log(`Running migrations against ${targetDbPath}...`);
  const db = createDatabase(targetDbPath, { autoMigrate: false });
  try {
    const applied = runMigrations(db, migrationsDir);
    if (applied.length === 0) {
      console.log('No new migrations to apply.');
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const m of applied) {
        console.log(` - ${m}`);
      }
    }
    return applied;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  runCliMigrations();
}
