import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import Fastify from 'fastify';
import { registerAuth } from '../src/auth/routes.js';
import type { WhatsAppManager } from '../src/whatsapp/manager.js';

test('health responde sin depender de PostgreSQL', async (t) => {
  const pool = new pg.Pool({ host: '127.0.0.1', port: 1, connectionTimeoutMillis: 200 });
  const app = buildApp(pool);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('ready devuelve 503 sin exponer credenciales cuando PostgreSQL no responde', async (t) => {
  const pool = new pg.Pool({
    host: '127.0.0.1', port: 1, password: 'must-not-leak', connectionTimeoutMillis: 200,
  });
  const app = buildApp(pool);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/api/ready' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'error', database: 'unavailable' });
  assert.ok(!response.body.includes('must-not-leak'));
});


test('los logs HTTP y de errores no incluyen búsquedas ni detalles sensibles', () => {
  const script = `import { EventEmitter } from 'node:events';
    import { buildApp } from './src/app.ts';
    const pool = new EventEmitter(); pool.query = async () => { throw new Error('secreto-en-error'); }; pool.end = async () => {};
    const app = buildApp(pool);
    await app.inject({ method: 'GET', url: '/api/health?search=busqueda-privada' });
    await app.inject({ method: 'GET', url: '/api/ready' });
    await app.inject({ method: 'GET', url: '/no-existe?search=busqueda-privada' });
    await app.close();`;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.doesNotMatch(child.stdout + child.stderr, /busqueda-privada|secreto-en-error/);
});


test('sin auditoría no se ejecutan mutaciones autenticadas', async (t) => {
  let mutated = false;
  const principal = { id: '11111111-1111-4111-8111-111111111111', organization_id: '22222222-2222-4222-8222-222222222222', role: 'operator', display_name: 'Prueba' };
  const pool = { query: async (sql: string) => {
    if (sql.includes('FROM auth_sessions')) return { rows: [principal], rowCount: 1 };
    if (sql.includes('INSERT INTO security_audit')) throw new Error('audit unavailable');
    mutated = true; return { rows: [], rowCount: 0 };
  } } as unknown as pg.Pool;
  const app = Fastify(); registerAuth(app, pool, {} as WhatsAppManager); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/conversations/33333333-3333-4333-8333-333333333333/notes', headers: { authorization: `Bearer ${'a'.repeat(64)}` }, payload: { body: 'Prueba' } });
  assert.equal(response.statusCode, 503); assert.equal(mutated, false);
});
