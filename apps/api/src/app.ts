import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerAuth } from './auth/routes.js';
import { WhatsAppManager } from './whatsapp/manager.js';
import { WhatsAppIngestion } from './whatsapp/ingestion.js';

export function buildApp(pool: Pool) {
  const app = Fastify({ logger: true, logController: new Fastify.LogController({ disableRequestLogging: true }) });

  pool.on('error', () => {
    app.log.error({ code: 'database_pool_error' }, 'Error en una conexión PostgreSQL inactiva');
  });

  app.setErrorHandler((error, request, reply) => {
    const code = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    const status = code >= 400 && code < 500 ? code : 500;
    request.log.error({ code: 'request_failed', status }, 'Error al procesar solicitud');
    void reply.code(status).send({ error: status === 500 ? 'Error interno' : 'Solicitud inválida' });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
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
    } catch {
      request.log.error({ code: 'database_unavailable' }, 'PostgreSQL no está disponible');
      return reply.code(503).send({ status: 'error', database: 'unavailable' });
    }
  });

  app.addHook('onClose', async () => { await whatsapp.close(); await ingestion.stop(); await pool.end(); });
  return app;
}
