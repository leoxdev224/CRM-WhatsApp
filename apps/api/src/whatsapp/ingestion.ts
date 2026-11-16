import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { WAMessage, WAMessageUpdate } from '@whiskeysockets/baileys';
import { normalizeMessage } from './normalize-message.js';
import type { NormalizedMessage } from './normalize-message.js';
import { normalizeMessageStatus } from './message-status.js';

type StatusEvent = { externalId: string; status: number };

export class WhatsAppIngestion {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(private pool: Pool, private reportError: (code: string) => void) {}

  start() { this.timer = setInterval(() => { void this.drain(); }, 5000); void this.drain(); }
  async stop() { if (this.timer) clearInterval(this.timer); while (this.running) await new Promise((resolve) => setTimeout(resolve, 10)); }

  async messages(channel: string, messages: WAMessage[]) {
    for (const message of messages) {
      const normalized = normalizeMessage(message);
      if (normalized) await this.enqueue(channel, 'message', normalized);
    }
  }
  async statuses(channel: string, updates: WAMessageUpdate[]) {
    for (const update of updates) {
      const status = update.update.status;
      if (update.key.id && normalizeMessageStatus(status)) await this.enqueue(channel, 'status', { externalId: update.key.id, status: status! });
    }
  }
  private async enqueue(channel: string, type: 'message' | 'status', payload: NormalizedMessage | StatusEvent) {
    const serialized = JSON.stringify(payload);
    const key = createHash('sha256').update(type).update(serialized).digest('hex');
    await this.pool.query(`INSERT INTO whatsapp_message_events (organization_id, channel_account_id, event_key, event_type, payload)
      SELECT organization_id,id,$2,$3,$4::jsonb FROM channel_accounts WHERE id=$1 AND connection_type='whatsapp_web'
      ON CONFLICT (channel_account_id,event_key) DO NOTHING`, [channel, key, type, serialized]);
    void this.drain();
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      for (let count = 0; count < 100; count++) {
        const client = await this.pool.connect();
        let eventId: string | null = null;
        try {
          await client.query('BEGIN');
          const result = await client.query<{ id: string; organization_id: string; channel_account_id: string; event_type: 'message' | 'status'; payload: NormalizedMessage | StatusEvent }>(
            "SELECT id,organization_id,channel_account_id,event_type,payload FROM whatsapp_message_events WHERE status IN ('pending','failed') AND attempts < 5 AND next_attempt_at <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1");
          const event = result.rows[0];
          if (!event) { await client.query('COMMIT'); break; }
          eventId = event.id;
          await client.query('SAVEPOINT process_event');
          if (event.event_type === 'message') await this.saveMessage(client, event.organization_id, event.channel_account_id, event.payload as NormalizedMessage);
          else await this.saveStatus(client, event.organization_id, event.channel_account_id, event.payload as StatusEvent);
          await client.query("UPDATE whatsapp_message_events SET status='processed',payload='{}'::jsonb,processed_at=now(),error_code=NULL WHERE id=$1", [eventId]);
          await client.query('COMMIT');
        } catch {
          if (eventId) {
            try {
              await client.query('ROLLBACK TO SAVEPOINT process_event');
              await client.query("UPDATE whatsapp_message_events SET attempts=attempts+1,status='failed',error_code='processing_error',next_attempt_at=now()+interval '30 seconds' WHERE id=$1", [eventId]);
              await client.query('COMMIT');
            } catch { await client.query('ROLLBACK').catch(() => {}); }
          } else await client.query('ROLLBACK').catch(() => {});
          this.reportError('whatsapp_event_processing_failed');
          break;
        } finally { client.release(); }
      }
    } catch { this.reportError('whatsapp_queue_unavailable'); }
    finally { this.running = false; }
  }
  private async saveStatus(client: PoolClient, org: string, channel: string, status: StatusEvent) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`message:${channel}:${status.externalId}`]);
    await client.query(`INSERT INTO whatsapp_pending_statuses (organization_id,channel_account_id,provider_message_id,status) VALUES ($1,$2,$3,$4)
      ON CONFLICT (channel_account_id,provider_message_id) DO UPDATE SET status=GREATEST(whatsapp_pending_statuses.status,EXCLUDED.status)`, [org, channel, status.externalId, status.status]);
    const result = await client.query('UPDATE messages SET delivery_status=GREATEST(COALESCE(delivery_status,0),$3) WHERE channel_account_id=$1 AND provider_message_id=$2', [channel, status.externalId, status.status]);
    if (result.rowCount) await client.query('DELETE FROM whatsapp_pending_statuses WHERE channel_account_id=$1 AND provider_message_id=$2', [channel, status.externalId]);
  }
  private async saveMessage(client: PoolClient, org: string, channel: string, message: NormalizedMessage) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`message:${channel}:${message.externalId}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`chat:${channel}:${message.chatId}`]);
    const duplicate = await client.query('SELECT 1 FROM messages WHERE channel_account_id=$1 AND provider_message_id=$2', [channel, message.externalId]);
    if (duplicate.rowCount) return;
    const existing = await client.query<{ id: string }>('SELECT id FROM conversations WHERE channel_account_id=$1 AND external_id=$2', [channel, message.chatId]);
    let conversation = existing.rows[0]?.id;
    if (!conversation) {
      let contact: string | null = null;
      if (message.kind === 'individual') {
        const identity = await client.query<{ contact_id: string }>('SELECT contact_id FROM contact_identities WHERE channel_account_id=$1 AND external_id=$2', [channel, message.chatId]);
        contact = identity.rows[0]?.contact_id ?? null;
        if (!contact) {
          const inserted = await client.query<{ id: string }>('INSERT INTO contacts (organization_id,display_name) VALUES ($1,$2) RETURNING id', [org, message.displayName || message.chatId]);
          contact = inserted.rows[0]!.id;
          await client.query('INSERT INTO contact_identities (organization_id,channel_account_id,contact_id,external_id) VALUES ($1,$2,$3,$4)', [org, channel, contact, message.chatId]);
        }
      }
      const created = await client.query<{ id: string }>('INSERT INTO conversations (organization_id,channel_account_id,contact_id,external_id,kind) VALUES ($1,$2,$3,$4,$5) RETURNING id', [org, channel, contact, message.chatId, message.kind]);
      conversation = created.rows[0]!.id;
    }
    await client.query(`INSERT INTO messages (organization_id,channel_account_id,conversation_id,provider_message_id,direction,message_type,body,occurred_at,sender_external_id,delivery_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT status FROM whatsapp_pending_statuses WHERE channel_account_id=$2 AND provider_message_id=$4))
      ON CONFLICT (organization_id,channel_account_id,provider_message_id) DO NOTHING`, [org, channel, conversation, message.externalId, message.direction, message.messageType, message.body, message.occurredAt, message.senderId]);
    await client.query('DELETE FROM whatsapp_pending_statuses WHERE channel_account_id=$1 AND provider_message_id=$2', [channel, message.externalId]);
    await client.query('UPDATE conversations SET last_message_at=GREATEST(COALESCE(last_message_at,$2),$2) WHERE id=$1', [conversation, message.occurredAt]);
  }
}
