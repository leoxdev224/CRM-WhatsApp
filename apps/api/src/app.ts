import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerAuth } from './auth/routes.js';
import { WhatsAppManager } from './whatsapp/manager.js';
import { WhatsAppIngestion } from './whatsapp/ingestion.js';

export function buildApp(pool: Pool) {
  const app = Fastify({ logger: true });

  pool.on('error', (error) => {
    app.log.error({ err: error }, 'Error en una conexión PostgreSQL inactiva');
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  const reportError = (code: string) => app.log.error({ code }, 'Error en procesamiento de WhatsApp');
  const ingestion = new WhatsAppIngestion(pool, reportError);
  const whatsapp = new WhatsAppManager(pool, ingestion, reportError);
  registerAuth(app, pool, whatsapp);
  app.addHook('onReady', async () => { ingestion.start(); });

  app.get('/api/ready', async (request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'connected' };
    } catch (error) {
      request.log.error({ err: error }, 'PostgreSQL no está disponible');
      return reply.code(503).send({ status: 'error', database: 'unavailable' });
    }
  });

  app.addHook('onClose', async () => { await whatsapp.close(); await ingestion.stop(); await pool.end(); });
  return app;
}
