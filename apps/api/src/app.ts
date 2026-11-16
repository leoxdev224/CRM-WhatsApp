import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerAuth } from './auth/routes.js';
import { WhatsAppManager } from './whatsapp/manager.js';

export function buildApp(pool: Pool) {
  const app = Fastify({ logger: true });

  pool.on('error', (error) => {
    app.log.error({ err: error }, 'Error en una conexión PostgreSQL inactiva');
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  const whatsapp = new WhatsAppManager(pool);
  registerAuth(app, pool, whatsapp);

  app.get('/api/ready', async (request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'connected' };
    } catch (error) {
      request.log.error({ err: error }, 'PostgreSQL no está disponible');
      return reply.code(503).send({ status: 'error', database: 'unavailable' });
    }
  });

  app.addHook('onClose', async () => { await whatsapp.close(); await pool.end(); });
  return app;
}
