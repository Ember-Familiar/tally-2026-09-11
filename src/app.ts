import express, { Express, NextFunction, Request, Response } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
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

  // Serve static UI assets from public directory (resolved relative to module location)
  const publicDir = path.resolve(__dirname, '../public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir, { index: false }));
  } else {
    console.warn(`[tally] public/ directory not found at ${publicDir}; UI static asset serving disabled.`);
  }

  const healthHandler = (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'ok' });
  };

  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  // Root endpoint: serve UI HTML when HTML requested, or JSON info for API clients
  app.get('/', (req: Request, res: Response) => {
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      const indexPath = path.join(publicDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile('index.html', { root: publicDir });
        return;
      }
    }

    res.status(200).json({
      name: 'tally',
      description: 'Expense-splitting web app',
      version: '0.1.0',
      status: 'ok',
    });
  });

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
