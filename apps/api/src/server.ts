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
    void app.close().catch(() => {
      app.log.error({ code: 'shutdown_failed' }, 'Error al detener la API');
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({
    host: process.env.API_HOST ?? '127.0.0.1',
    port: Number(process.env.API_PORT ?? 3002),
  });
} catch {
  app.log.error({ code: 'startup_failed' }, 'No se pudo iniciar la API');
  await app.close();
  process.exitCode = 1;
}
