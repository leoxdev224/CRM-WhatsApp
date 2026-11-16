import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import pg from 'pg';
import { WhatsAppIngestion } from '../src/whatsapp/ingestion.js';

test('guarda eventos individuales y grupos por canal, sin duplicados y con estados fuera de orden', async (t) => {
  const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
  const org = randomUUID(); const channel = randomUUID(); const second = randomUUID();
  const errors: string[] = [];
  const ingestion = new WhatsAppIngestion(pool, (code) => errors.push(code));
  t.after(async () => {
    await ingestion.stop();
    await pool.query('DELETE FROM whatsapp_message_events WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM whatsapp_pending_statuses WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM messages WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM conversations WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM contact_identities WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM contacts WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM channel_accounts WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM organizations WHERE id=$1', [org]);
    await pool.end();
  });
  await pool.query('INSERT INTO organizations (id,name,slug) VALUES ($1,$2,$3)', [org, 'Prueba', org]);
  await pool.query("INSERT INTO channel_accounts (id,organization_id,display_name,connection_type) VALUES ($1,$3,'A','whatsapp_web'),($2,$3,'B','whatsapp_web')", [channel, second, org]);
  const key = { id: 'msg-1', remoteJid: '1234567@s.whatsapp.net', fromMe: false };
  const message = { key, messageTimestamp: 1700000000, message: { conversation: 'Hola' } };
  await ingestion.statuses(channel, [{ key, update: { status: 4 } }, { key, update: { status: 2 } }]);
  await ingestion.messages(channel, [message, message, { key: { id: 'grupo-1', remoteJid: '123@g.us', participant: '456@s.whatsapp.net', fromMe: false }, messageTimestamp: 1700000001, message: { conversation: 'Grupo' } }]);
  await ingestion.messages(second, [message]);
  for (let i = 0; i < 80; i++) {
    await ingestion.drain();
    const remaining = await pool.query<{ count: string }>("SELECT count(*) FROM whatsapp_message_events WHERE organization_id=$1 AND status <> 'processed'", [org]);
    if (remaining.rows[0]?.count === '0') break;
    await delay(50);
  }
  const results = await pool.query<{ channel_account_id: string; provider_message_id: string; delivery_status: number | null; kind: string; sender_external_id: string | null }>(`SELECT m.channel_account_id,m.provider_message_id,m.delivery_status,c.kind,m.sender_external_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.organization_id=$1 ORDER BY m.provider_message_id,m.channel_account_id`, [org]);
  assert.equal(results.rows.length, 3);
  assert.equal(results.rows.find((row) => row.provider_message_id === 'grupo-1')?.kind, 'group');
  assert.equal(results.rows.find((row) => row.provider_message_id === 'grupo-1')?.sender_external_id, '456@s.whatsapp.net');
  assert.equal(results.rows.find((row) => row.channel_account_id === channel && row.provider_message_id === 'msg-1')?.delivery_status, 4);
  assert.equal(results.rows.find((row) => row.channel_account_id === second && row.provider_message_id === 'msg-1')?.delivery_status, null);
  assert.deepEqual(errors, []);
  await ingestion.stop();
  const failedEvent = await pool.query<{ id: string }>(`INSERT INTO whatsapp_message_events
    (organization_id,channel_account_id,event_key,event_type,payload) VALUES ($1,$2,'retry-test','status',$3) RETURNING id`,
    [org, channel, JSON.stringify({ externalId: 'msg-1', status: 99 })]);
  const eventId = failedEvent.rows[0]!.id;
  await ingestion.drain();
  const failed = await pool.query<{ status: string; attempts: number }>('SELECT status,attempts FROM whatsapp_message_events WHERE id=$1', [eventId]);
  assert.deepEqual(failed.rows[0], { status: 'failed', attempts: 1 });
  assert.deepEqual(errors, ['whatsapp_event_processing_failed']);
  await pool.query("UPDATE whatsapp_message_events SET payload=$2,next_attempt_at=now() WHERE id=$1", [eventId, JSON.stringify({ externalId: 'msg-1', status: 5 })]);
  await ingestion.drain();
  const recovered = await pool.query<{ status: string; payload: object }>('SELECT status,payload FROM whatsapp_message_events WHERE id=$1', [eventId]);
  assert.deepEqual(recovered.rows[0], { status: 'processed', payload: {} });
  const updated = await pool.query<{ delivery_status: number }>('SELECT delivery_status FROM messages WHERE channel_account_id=$1 AND provider_message_id=$2', [channel, 'msg-1']);
  assert.equal(updated.rows[0]?.delivery_status, 5);
});
