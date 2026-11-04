import pg from 'pg';
import { buildApp } from './app.js';

const pool = new pg.Pool({
  connectionTimeoutMillis: 3000,
  query_timeout: 3000,
  max: 5,
});
const app = buildApp(pool);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch((error: unknown) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({
    host: process.env.API_HOST ?? '127.0.0.1',
    port: Number(process.env.API_PORT ?? 3002),
  });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
