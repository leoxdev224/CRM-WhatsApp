import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreSession } from '../src/session.js';

test('restaura la sesión desde el token de la pestaña y consulta el usuario', async () => {
  const storage = { getItem: () => 'abc', removeItem: () => {} };
  const result = await restoreSession(storage, async (_url, options) => {
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer abc');
    return new Response(JSON.stringify({ user: { display_name: 'Admin', role: 'admin' } }), { status: 200 });
  });
  assert.deepEqual(result, { token: 'abc', name: 'Admin', role: 'admin' });
});

test('elimina una sesión vencida y conserva el token ante un error temporal', async () => {
  let token: string | null = 'abc';
  const storage = { getItem: () => token, removeItem: () => { token = null; } };
  assert.equal(await restoreSession(storage, async () => new Response(null, { status: 401 })), null);
  assert.equal(token, null);
  token = 'abc';
  await assert.rejects(restoreSession(storage, async () => { throw new Error('offline'); }));
  assert.equal(token, 'abc');
});
