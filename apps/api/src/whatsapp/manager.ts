import makeWASocket, { DisconnectReason, jidNormalizedUser } from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Pool, PoolClient } from 'pg';
import pino from 'pino';
import { createAuthStore } from './store.js';
import { claimAccount } from './claim.js';
import type { WhatsAppIngestion } from './ingestion.js';
import type { WAMessage, WAMessageUpdate } from '@whiskeysockets/baileys';
import { checkExitIp, closeProxyAgents, createProxyAgents, decryptProxy } from './proxy.js';
import type { ProxyAgents } from './proxy.js';

type Entry = { socket?: WASocket; qr: string | null; qrAt: number; state: 'starting' | 'qr' | 'connected' | 'disconnected' | 'duplicate' | 'duplicate_cleanup_failed'; saving: Promise<void>; proxy?: ProxyAgents };

/** Estado de red de un canal que sobrevive entre reconexiones. Sin credenciales. */
type Health = { exitIp: string | null; reconnects: number; attempt: number; lastError: string | null; lastConnectedAt: number | null; nextRetryAt: number | null; timer?: NodeJS.Timeout };

/** Cortes de red que justifican reintentar solos. Se excluyen cierre de sesión, sesión reemplazada y bloqueo. */
const RETRYABLE = new Set<number>([DisconnectReason.connectionClosed, DisconnectReason.connectionLost, DisconnectReason.unavailableService, DisconnectReason.badSession]);
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];

export class WhatsAppManager {
  private entries = new Map<string, Entry>();
  private health = new Map<string, Health>();
  private closing = false;
  private lock: PoolClient | null = null;
  private locking: Promise<void> | null = null;
  constructor(private pool: Pool, private ingestion?: WhatsAppIngestion, private reportError: (code: string) => void = () => {}) {}

  get(id: string) {
    const entry = this.entries.get(id);
    const health = this.health.get(id);
    return {
      state: entry?.state ?? 'disconnected',
      qr: entry && Date.now() - entry.qrAt < 60000 ? entry.qr : null,
      exitIp: health?.exitIp ?? null,
      reconnects: health?.reconnects ?? 0,
      lastError: health?.lastError ?? null,
      nextRetryAt: health?.nextRetryAt ?? null,
    };
  }

  private healthOf(id: string): Health {
    let health = this.health.get(id);
    if (!health) { health = { exitIp: null, reconnects: 0, attempt: 0, lastError: null, lastConnectedAt: null, nextRetryAt: null }; this.health.set(id, health); }
    return health;
  }

  private cancelRetry(id: string) {
    const health = this.health.get(id);
    if (health?.timer) clearTimeout(health.timer);
    if (health) { health.timer = undefined; health.nextRetryAt = null; }
  }

  /** Reintenta con espera creciente. Si el proxy sigue caído, vuelve a programarse (nunca sale sin proxy). */
  private scheduleRetry(id: string) {
    if (this.closing) return;
    const health = this.healthOf(id);
    if (health.timer) return;
    const delay = RETRY_DELAYS_MS[Math.min(health.attempt, RETRY_DELAYS_MS.length - 1)]!;
    health.attempt += 1;
    health.nextRetryAt = Date.now() + delay;
    health.timer = setTimeout(() => {
      health.timer = undefined; health.nextRetryAt = null;
      if (this.closing || this.entries.has(id)) return;
      health.reconnects += 1;
      void this.start(id).catch(() => this.scheduleRetry(id));
    }, delay);
    health.timer.unref();
  }

  async sendText(id: string, jid: string, text: string, messageId: string) {
    const entry = this.entries.get(id);
    if (!entry?.socket || entry.state !== 'connected') throw new Error('Canal desconectado');
    await entry.socket.sendMessage(jid, { text }, { messageId });
  }

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
          for (const entry of active) { void entry.socket?.end(new Error('Se perdió la coordinación de sesiones')).catch(() => {}); void closeProxyAgents(entry.proxy); }
          client.release(true);
        });
      } catch (error) { client.release(); throw error; }
    })().finally(() => { this.locking = null; });
    await this.locking;
  }

  /**
   * Carga el proxy del canal y verifica la IP de salida antes de conectar.
   * Falla cerrado: si el canal tiene proxy y no responde, no se conecta por la IP del servidor.
   */
  private async prepareProxy(id: string): Promise<ProxyAgents | undefined> {
    const health = this.healthOf(id);
    const row = await this.pool.query<{ proxy_encrypted: string | null; proxy_exit_ip: string | null }>('SELECT proxy_encrypted, proxy_exit_ip FROM channel_accounts WHERE id=$1', [id]);
    const encrypted = row.rows[0]?.proxy_encrypted;
    if (!encrypted) { health.exitIp = null; return undefined; }
    let agents: ProxyAgents | undefined;
    try {
      agents = createProxyAgents(decryptProxy(encrypted, id));
      const ip = await checkExitIp(agents);
      if (row.rows[0]?.proxy_exit_ip && row.rows[0].proxy_exit_ip !== ip) this.reportError('whatsapp_proxy_ip_changed');
      await this.pool.query('UPDATE channel_accounts SET proxy_exit_ip=$2, proxy_checked_at=now() WHERE id=$1', [id, ip]);
      health.exitIp = ip; health.lastError = null;
      return agents;
    } catch (error) {
      await closeProxyAgents(agents);
      health.lastError = 'proxy_unavailable';
      this.reportError('whatsapp_proxy_unavailable');
      throw error;
    }
  }

  async start(id: string) {
    const previous = this.entries.get(id);
    if (previous?.state === 'duplicate_cleanup_failed') throw new Error('La sesión duplicada necesita revisión.');
    if (previous?.state === 'duplicate') this.entries.delete(id);
    else if (previous && !previous.socket) throw new Error('El canal está procesando otra operación.');
    else if (previous) return;
    this.cancelRetry(id);
    const entry: Entry = { qr: null, qrAt: 0, state: 'starting', saving: Promise.resolve() };
    this.entries.set(id, entry);
    try {
      await this.ensureLock();
      entry.proxy = await this.prepareProxy(id);
      if (this.entries.get(id) !== entry) { await closeProxyAgents(entry.proxy); return; }
      const auth = await createAuthStore(this.pool, id);
      const socket = makeWASocket({
        auth: auth.state, logger: pino({ level: 'silent' }), syncFullHistory: false,
        // Con proxy, los tres caminos de red salen por él: WebSocket, subida de media y fetch (media, app-state, historial).
        ...(entry.proxy ? { agent: entry.proxy.agent, fetchAgent: entry.proxy.fetchAgent, options: { dispatcher: entry.proxy.dispatcher } as RequestInit } : {}),
      });
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
          }).then((result) => {
            if (this.entries.get(id) !== entry) return;
            entry.state = result;
            if (result === 'connected') {
              const health = this.healthOf(id); health.attempt = 0; health.lastError = null; health.lastConnectedAt = Date.now();
              for (const event of pending.splice(0)) deliver(event);
            } else pending.length = 0;
          }).catch(() => {
            entry.state = 'disconnected';
            void socket.end(new Error('No se pudo guardar el estado')).catch(() => {});
          });
        }
        if (update.connection === 'close') {
          if (entry.state === 'duplicate' || entry.state === 'duplicate_cleanup_failed') return;
          const wasLinked = Boolean(auth.state.creds.me);
          entry.qr = null; entry.state = 'disconnected';
          this.entries.delete(id);
          void closeProxyAgents(entry.proxy);
          const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          if (code === DisconnectReason.restartRequired) {
            void entry.saving.then(() => this.start(id)).catch(() => this.scheduleRetry(id));
            return;
          }
          const health = this.healthOf(id);
          health.lastError = code ? `disconnect_${code}` : 'disconnect_unknown';
          void entry.saving.then(async () => {
            if (code === DisconnectReason.loggedOut) await this.pool.query('DELETE FROM whatsapp_auth_state WHERE channel_account_id=$1', [id]);
            await this.pool.query("UPDATE channel_accounts SET connection_status=$2 WHERE id=$1 AND connection_status <> 'revoked'", [id, code === DisconnectReason.loggedOut ? 'revoked' : 'disconnected']);
          }).catch(() => {}).finally(() => {
            // Solo se reintenta si el número ya estaba vinculado y el corte fue de red.
            if (wasLinked && code !== undefined && RETRYABLE.has(code)) this.scheduleRetry(id);
          });
        }
      });
    } catch (error) {
      if (this.entries.get(id) === entry) this.entries.delete(id);
      await closeProxyAgents(entry.proxy);
      throw error;
    }
  }

  async disconnect(id: string) {
    this.cancelRetry(id);
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
    await closeProxyAgents(entry.proxy);
    this.health.delete(id);
    await this.pool.query('DELETE FROM whatsapp_auth_state WHERE channel_account_id=$1', [id]);
    await this.pool.query("UPDATE channel_accounts SET connection_status='revoked' WHERE id=$1", [id]);
  }

  /** true si el canal está activo o iniciándose; en ese caso no se permite cambiar su proxy. */
  isActive(id: string) { return this.entries.has(id); }

  async close() {
    this.closing = true;
    for (const id of this.health.keys()) this.cancelRetry(id);
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) { await entry.socket?.end(undefined); await entry.saving; await closeProxyAgents(entry.proxy); }
    if (this.lock) { await this.lock.query('SELECT pg_advisory_unlock($1)', [842024005]); this.lock.release(); this.lock = null; }
  }
}
