import express, { Express, Request, Response } from 'express';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  const healthHandler = (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'ok' });
  };

  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  return app;
}

export const app: Express = createApp();
export default app;
