import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../src/app.js';

test('health responde sin depender de PostgreSQL', async (t) => {
  const pool = new pg.Pool({ host: '127.0.0.1', port: 1, connectionTimeoutMillis: 200 });
  const app = buildApp(pool);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
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
