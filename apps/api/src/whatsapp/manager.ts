import makeWASocket, { DisconnectReason, jidNormalizedUser } from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Pool, PoolClient } from 'pg';
import pino from 'pino';
import { createAuthStore } from './store.js';
import { claimAccount } from './claim.js';
import type { WhatsAppIngestion } from './ingestion.js';
import type { WAMessage, WAMessageUpdate } from '@whiskeysockets/baileys';

type Entry = { socket?: WASocket; qr: string | null; qrAt: number; state: 'starting' | 'qr' | 'connected' | 'disconnected' | 'duplicate' | 'duplicate_cleanup_failed'; saving: Promise<void> };

export class WhatsAppManager {
  private entries = new Map<string, Entry>();
  private lock: PoolClient | null = null;
  private locking: Promise<void> | null = null;
  constructor(private pool: Pool, private ingestion?: WhatsAppIngestion, private reportError: (code: string) => void = () => {}) {}

  get(id: string) { const entry = this.entries.get(id); return { state: entry?.state ?? 'disconnected', qr: entry && Date.now() - entry.qrAt < 60000 ? entry.qr : null }; }

  private async ensureLock() {
    if (this.lock) return;
    if (!this.locking) this.locking = (async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [842024005]);
        if (!result.rows[0]?.locked) throw new Error('Otro proceso administra las sesiones.');
        this.lock = client;
        client.on('error', () => {
          if (this.lock !== client) return;
          this.lock = null;
          const active = [...this.entries.values()];
          this.entries.clear();
          for (const entry of active) void entry.socket?.end(new Error('Se perdió la coordinación de sesiones')).catch(() => {});
          client.release(true);
        });
      } catch (error) { client.release(); throw error; }
    })().finally(() => { this.locking = null; });
    await this.locking;
  }

  async start(id: string) {
    const previous = this.entries.get(id);
    if (previous?.state === 'duplicate_cleanup_failed') throw new Error('La sesión duplicada necesita revisión.');
    if (previous?.state === 'duplicate') this.entries.delete(id);
    else if (previous && !previous.socket) throw new Error('El canal está procesando otra operación.');
    else if (previous) return;
    const entry: Entry = { qr: null, qrAt: 0, state: 'starting', saving: Promise.resolve() };
    this.entries.set(id, entry);
    try {
      await this.ensureLock();
      const auth = await createAuthStore(this.pool, id);
      const socket = makeWASocket({ auth: auth.state, logger: pino({ level: 'silent' }), syncFullHistory: false });
      entry.socket = socket;
      const pending: Array<{ type: 'messages'; data: WAMessage[] } | { type: 'statuses'; data: WAMessageUpdate[] }> = [];
      const deliver = (event: (typeof pending)[number]) => {
        if (!this.ingestion) return;
        const promise = event.type === 'messages' ? this.ingestion.messages(id, event.data) : this.ingestion.statuses(id, event.data);
        void promise.catch(() => this.reportError('whatsapp_event_enqueue_failed'));
      };
      const receive = (event: (typeof pending)[number]) => {
        if (this.entries.get(id) !== entry) return;
        if (entry.state === 'connected') deliver(event);
        else if (entry.state === 'starting' || entry.state === 'qr') {
          if (pending.length < 500) pending.push(event);
          else this.reportError('whatsapp_event_buffer_full');
        }
      };
      socket.ev.on('messages.upsert', ({ messages }) => receive({ type: 'messages', data: messages }));
      socket.ev.on('messages.update', (updates) => receive({ type: 'statuses', data: updates }));
      socket.ev.on('creds.update', () => {
        entry.saving = entry.saving.then(auth.saveCreds).catch(() => { entry.state = 'disconnected'; entry.qr = null; void socket.end(new Error('No se pudo guardar la sesión')).catch(() => {}); });
      });
      socket.ev.on('connection.update', (update) => {
        if (this.entries.get(id) !== entry) return;
        if (update.qr) { entry.qr = update.qr; entry.qrAt = Date.now(); entry.state = 'qr'; }
        if (update.connection === 'open') {
          entry.qr = null; entry.state = 'starting';
          const jid = socket.user?.id ? jidNormalizedUser(socket.user.id) : '';
          const digits = jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : '';
          const phone = digits && /^[1-9][0-9]{6,14}$/.test(digits) ? `+${digits}` : null;
          void claimAccount(this.pool, id, jid, phone, async () => {
            entry.state = 'duplicate';
            await socket.logout();
            await entry.saving;
          }).then((result) => { if (this.entries.get(id) !== entry) return; entry.state = result; if (result === 'connected') for (const event of pending.splice(0)) deliver(event); else pending.length = 0; }).catch(() => {
            entry.state = 'disconnected';
            void socket.end(new Error('No se pudo guardar el estado')).catch(() => {});
          });
        }
        if (update.connection === 'close') {
          if (entry.state === 'duplicate' || entry.state === 'duplicate_cleanup_failed') return;
          entry.qr = null; entry.state = 'disconnected';
          this.entries.delete(id);
          const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          if (code === DisconnectReason.restartRequired) {
            void entry.saving.then(() => this.start(id)).catch(() => {});
            return;
          }
          void entry.saving.then(async () => {
            if (code === DisconnectReason.loggedOut) await this.pool.query('DELETE FROM whatsapp_auth_state WHERE channel_account_id=$1', [id]);
            await this.pool.query("UPDATE channel_accounts SET connection_status=$2 WHERE id=$1 AND connection_status <> 'revoked'", [id, code === DisconnectReason.loggedOut ? 'revoked' : 'disconnected']);
          }).catch(() => {});
        }
      });
    } catch (error) { this.entries.delete(id); throw error; }
  }

  async disconnect(id: string) {
    const entry = this.entries.get(id);
    if (!entry) {
      const guard: Entry = { qr: null, qrAt: 0, state: 'starting', saving: Promise.resolve() };
      this.entries.set(id, guard);
      try {
        const result = await this.pool.query(`UPDATE channel_accounts SET connection_status='revoked'
          WHERE id=$1 AND connection_type='whatsapp_web' AND phone_number IS NULL AND provider_account_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM whatsapp_auth_state WHERE channel_account_id=$1)`, [id]);
        if (result.rowCount !== 1) throw new Error('El canal debe estar activo para desvincularlo.');
        return;
      } finally { if (this.entries.get(id) === guard) this.entries.delete(id); }
    }
    if (!entry.socket) throw new Error('El canal está iniciándose; intentá nuevamente.');
    await entry.socket.logout();
    this.entries.delete(id); entry.qr = null;
    await entry.saving;
    await this.pool.query('DELETE FROM whatsapp_auth_state WHERE channel_account_id=$1', [id]);
    await this.pool.query("UPDATE channel_accounts SET connection_status='revoked' WHERE id=$1", [id]);
  }

  async close() {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) { await entry.socket?.end(undefined); await entry.saving; }
    if (this.lock) { await this.lock.query('SELECT pg_advisory_unlock($1)', [842024005]); this.lock.release(); this.lock = null; }
  }
}
