import express, { Express, NextFunction, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { createDatabase } from './db';
import { createGroupRouter } from './routes/groups';

const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  406: 'Not acceptable',
  408: 'Request timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length required',
  412: 'Precondition failed',
  413: 'Payload too large',
  414: 'URI too long',
  415: 'Unsupported media type',
  422: 'Unprocessable entity',
  429: 'Too many requests',
};

export function createApp(db?: Database.Database): Express {
  const app = express();
  const database = db ?? createDatabase();

  app.use(express.json());

  const healthHandler = (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'ok' });
  };

  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  app.use('/groups', createGroupRouter(database));

  // Catch-all 404 handler for unmatched routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Centralized error-handling middleware
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400) {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    if (typeof err === 'object' && err !== null) {
      const candidateStatus =
        'status' in err && typeof (err as { status: unknown }).status === 'number'
          ? (err as { status: number }).status
          : 'statusCode' in err && typeof (err as { statusCode: unknown }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : undefined;

      if (candidateStatus !== undefined && candidateStatus >= 400 && candidateStatus < 500) {
        const message = CLIENT_ERROR_MESSAGES[candidateStatus] ?? 'Bad request';
        res.status(candidateStatus).json({ error: message });
        return;
      }
    }

    // Log useful server-side diagnostics for unexpected 500s without leaking to client
    console.error('Unhandled internal server error:', err);

    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export const app: Express = createApp();
export default app;
