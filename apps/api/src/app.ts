import Fastify from 'fastify';
import type { Pool } from 'pg';

export function buildApp(pool: Pool) {
  const app = Fastify({ logger: true });

  pool.on('error', (error) => {
    app.log.error({ err: error }, 'Error en una conexión PostgreSQL inactiva');
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/ready', async (request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'connected' };
    } catch (error) {
      request.log.error({ err: error }, 'PostgreSQL no está disponible');
      return reply.code(503).send({ status: 'error', database: 'unavailable' });
    }
  });

  app.addHook('onClose', async () => { await pool.end(); });
  return app;
}
