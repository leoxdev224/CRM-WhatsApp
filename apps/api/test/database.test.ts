import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../src/app.js';

test('ready comprueba una conexión real con PostgreSQL y cierra el pool al apagar', async (t) => {
  const pool = new pg.Pool({ connectionTimeoutMillis: 3000, query_timeout: 3000 });
  const app = buildApp(pool);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/api/ready' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', database: 'connected' });

  await app.close();
  await assert.rejects(pool.query('SELECT 1'), /after calling end/);
});
