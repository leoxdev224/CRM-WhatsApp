import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import type pg from 'pg';
import { registerAuth } from '../src/auth/routes.js';
import type { WhatsAppManager } from '../src/whatsapp/manager.js';
import { checkExitIp, closeProxyAgents, createProxyAgents, decryptProxy, encryptProxy, maskProxy, parseProxyUrl } from '../src/whatsapp/proxy.js';

process.env.WHATSAPP_SESSION_KEY ??= 'ab'.repeat(32);
const channel = '33333333-3333-4333-8333-333333333333';

test('parseProxyUrl acepta socks5/http con credenciales y rechaza formatos inválidos', () => {
  assert.deepEqual(parseProxyUrl('socks5h://user:p%40ss@1.2.3.4:1080'), { protocol: 'socks5h', host: '1.2.3.4', port: 1080, username: 'user', password: 'p@ss' });
  assert.equal(parseProxyUrl('http://proxy.example.com:8080')?.protocol, 'http');
  for (const bad of ['', 'ftp://h:21', 'socks5://h', 'socks5://h:0', 'socks5://h:70000', 'http://h:80/path', 'http://h:80?x=1', 'no es url', 'x'.repeat(600)]) {
    assert.equal(parseProxyUrl(bad), null, bad);
  }
});

test('maskProxy nunca incluye usuario ni contraseña', () => {
  const config = parseProxyUrl('socks5://usuario:secreto@10.0.0.1:1080')!;
  assert.equal(maskProxy(config), 'socks5://10.0.0.1:1080');
  assert.doesNotMatch(maskProxy(config), /usuario|secreto/);
});

test('el proxy cifrado solo se descifra para el mismo canal', () => {
  const config = parseProxyUrl('socks5://usuario:secreto@10.0.0.1:1080')!;
  const encrypted = encryptProxy(config, channel);
  assert.doesNotMatch(encrypted, /secreto|usuario|10\.0\.0\.1/);
  assert.deepEqual(decryptProxy(encrypted, channel), config);
  assert.throws(() => decryptProxy(encrypted, '44444444-4444-4444-8444-444444444444'));
});

const bundledUndiciMajor = Number(process.versions.undici?.split('.')[0] ?? 0);
test('checkExitIp sale por el proxy configurado y falla cerrado si no responde', { skip: bundledUndiciMajor < 8 && 'requiere Node 26 (undici 8 incluido)' }, async (t) => {
  const seen: string[] = [];
  const proxy = http.createServer((request, response) => {
    seen.push(request.url ?? '');
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ip: '203.0.113.7' }));
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => proxy.close());
  const port = (proxy.address() as AddressInfo).port;

  const agents = createProxyAgents(parseProxyUrl(`http://127.0.0.1:${port}`)!);
  t.after(() => closeProxyAgents(agents));
  assert.equal(await checkExitIp(agents, 2000, 'http://destino.invalid/ip'), '203.0.113.7');
  assert.deepEqual(seen, ['http://destino.invalid/ip']);

  const dead = createProxyAgents(parseProxyUrl('http://127.0.0.1:1')!);
  t.after(() => closeProxyAgents(dead));
  await assert.rejects(checkExitIp(dead, 2000, 'http://destino.invalid/ip'));
});

function adminApp(t: { after: (fn: () => unknown) => void }, active: boolean) {
  const updates: unknown[][] = [];
  const principal = { id: '11111111-1111-4111-8111-111111111111', organization_id: '22222222-2222-4222-8222-222222222222', role: 'admin', display_name: 'Admin' };
  const pool = { query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM auth_sessions')) return { rows: [principal], rowCount: 1 };
    if (sql.includes('FROM channel_accounts WHERE id=$1 AND organization_id=$2')) return { rows: [{ id: channel }], rowCount: 1 };
    if (sql.startsWith('UPDATE channel_accounts SET proxy')) updates.push(params);
    return { rows: [], rowCount: 1 };
  } } as unknown as pg.Pool;
  const app = Fastify(); registerAuth(app, pool, { isActive: () => active } as unknown as WhatsAppManager); t.after(() => app.close());
  const put = (payload: unknown) => app.inject({ method: 'PUT', url: `/api/channels/${channel}/proxy`, headers: { authorization: `Bearer ${'a'.repeat(64)}` }, payload: payload as object });
  return { put, updates };
}

test('PUT proxy rechaza cambios con el canal activo y URLs inválidas', async (t) => {
  const activeApp = adminApp(t, true);
  assert.equal((await activeApp.put({ proxyUrl: 'socks5://h:1080' })).statusCode, 409);
  const idle = adminApp(t, false);
  assert.equal((await idle.put({ proxyUrl: 'ftp://h:21' })).statusCode, 400);
  assert.equal((await idle.put({ proxyUrl: 'http://127.0.0.1:1' })).statusCode, 422);
  assert.equal(idle.updates.length, 0);
  const cleared = await idle.put({ proxyUrl: null });
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(cleared.json(), { proxy: null });
  assert.equal(idle.updates.length, 1);
});
