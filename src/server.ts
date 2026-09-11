import { app } from './app';

export function parsePort(rawPort: string | undefined): number {
  const portStr = rawPort || '3000';
  const port = Number(portStr);
  if (!/^\d+$/.test(portStr) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT environment variable: ${portStr}`);
  }
  return port;
}

if (require.main === module) {
  const PORT = parsePort(process.env.PORT);
  app.listen(PORT, () => {
    console.log(`Tally server listening on port ${PORT}`);
  });
}
