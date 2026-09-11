import express, { Express, NextFunction, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { createDatabase } from './db';
import { createGroupRouter } from './routes/groups';

export function createApp(db?: Database.Database): Express {
  const app = express();
  const database = db ?? createDatabase();

  app.use(express.json());

  // Handle malformed JSON request bodies with 400
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400) {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }
    next(err);
  });

  const healthHandler = (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'ok' });
  };

  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  app.use('/groups', createGroupRouter(database));

  return app;
}

export const app: Express = createApp();
export default app;
