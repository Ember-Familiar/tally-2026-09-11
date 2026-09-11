import { app } from './app';

const rawPort = process.env.PORT || '3000';
const PORT = parseInt(rawPort, 10);
if (Number.isNaN(PORT) || PORT <= 0) {
  throw new Error(`Invalid PORT environment variable: ${rawPort}`);
}

app.listen(PORT, () => {
  console.log(`Tally server listening on port ${PORT}`);
});
