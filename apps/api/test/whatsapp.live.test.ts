import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { WhatsAppManager } from '../src/whatsapp/manager.js';

test('WhatsApp Web entrega un QR sin iniciar sesión', { timeout: 60000 }, async (t) => {
  process.env.WHATSAPP_SESSION_KEY = randomBytes(32).toString('hex');
  const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
  const manager = new WhatsAppManager(pool);
  const org = randomUUID(); const channel = randomUUID();
  t.after(async () => {
    await manager.close();
    await pool.query('DELETE FROM channel_accounts WHERE id=$1', [channel]);
    await pool.query('DELETE FROM organizations WHERE id=$1', [org]);
    await pool.end();
  });
  await pool.query('INSERT INTO organizations (id,name,slug) VALUES ($1,$2,$3)', [org, 'Prueba temporal', org]);
  await pool.query("INSERT INTO channel_accounts (id,organization_id,display_name,connection_type,connection_status) VALUES ($1,$2,$3,'whatsapp_web','disconnected')", [channel, org, 'Prueba temporal']);
  await manager.start(channel);
  for (let attempt = 0; attempt < 40; attempt++) {
    const status = manager.get(channel);
    if (status.qr) { assert.equal(status.state, 'qr'); return; }
    if (status.state === 'disconnected') throw new Error('WhatsApp cerró la conexión antes de generar el QR.');
    await delay(1000);
  }
  assert.fail('WhatsApp no entregó el QR dentro del tiempo esperado.');
});
