import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { verifyPassword } from './password.js';
import { decryptSecret, verifyCode } from './totp.js';
import QRCode from 'qrcode';
import type { WhatsAppManager } from '../whatsapp/manager.js';

type Principal = { id: string; organization_id: string; role: 'admin' | 'operator'; display_name: string };
declare module 'fastify' { interface FastifyRequest { principal: Principal | null } }

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sessionToken = (request: FastifyRequest) => {
  const match = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/);
  return match?.[1];
};

export function registerAuth(app: FastifyInstance, pool: Pool, whatsapp: WhatsAppManager) {
  app.decorateRequest('principal', null);

  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { email?: unknown; password?: unknown; code?: unknown } | null;
    if (typeof body?.email !== 'string' || typeof body.password !== 'string' || body.email.length > 254 || body.password.length > 1024 || !body.email.trim()) {
      return reply.code(400).send({ error: 'Datos inválidos' });
    }
    const email = body.email.trim().toLowerCase();
    const key = digest(email);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO auth_login_attempts (identity_hash) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
      const attempts = await client.query<{ locked: boolean }>(
        'SELECT locked_until > now() AS locked FROM auth_login_attempts WHERE identity_hash = $1 FOR UPDATE', [key],
      );
      if (attempts.rows[0]?.locked) {
        await client.query('COMMIT');
        return reply.code(429).send({ error: 'Demasiados intentos. Intentalo más tarde.' });
      }
      const result = await client.query<Principal & { password_hash: string | null; mfa_secret_encrypted: string | null; mfa_last_counter: string | null }>(
        `SELECT u.id, u.organization_id, u.role, u.display_name, u.password_hash, u.mfa_secret_encrypted, u.mfa_last_counter
         FROM users u JOIN organizations o ON o.id = u.organization_id
         WHERE lower(u.email) = $1 AND u.status = 'active' AND o.status = 'active' FOR UPDATE OF u`, [email],
      );
      const user = result.rows[0];
      const placeholder = 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128);
      const valid = await verifyPassword(body.password, user?.password_hash ?? placeholder);
      let counter: number | null = null;
      if (user && user.role === 'admin' && valid && user.mfa_secret_encrypted && typeof body.code === 'string') {
        counter = verifyCode(decryptSecret(user.mfa_secret_encrypted), body.code);
        if (counter !== null && user.mfa_last_counter !== null && counter <= Number(user.mfa_last_counter)) counter = null;
      }
      if (!user || !user.password_hash || !valid || (user.role === 'admin' && counter === null)) {
        await client.query(`UPDATE auth_login_attempts SET
          failures = CASE WHEN window_started_at < now() - interval '15 minutes' THEN 1 ELSE failures + 1 END,
          locked_until = CASE WHEN window_started_at >= now() - interval '15 minutes' AND failures + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
          window_started_at = CASE WHEN window_started_at < now() - interval '15 minutes' THEN now() ELSE window_started_at END
          WHERE identity_hash = $1`, [key]);
        await client.query('COMMIT');
        return reply.code(401).send({ error: 'Credenciales inválidas' });
      }
      if (counter !== null) await client.query('UPDATE users SET mfa_last_counter = $1 WHERE id = $2', [counter, user.id]);
      const token = randomBytes(32).toString('hex');
      await client.query("INSERT INTO auth_sessions (token_hash, user_id, expires_at, mfa_verified) VALUES ($1, $2, now() + interval '8 hours', $3)", [digest(token), user.id, counter !== null]);
      await client.query('DELETE FROM auth_login_attempts WHERE identity_hash = $1', [key]);
      await client.query('COMMIT');
      reply.header('Cache-Control', 'no-store');
      return { token, user: { id: user.id, organizationId: user.organization_id, role: user.role, displayName: user.display_name } };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });

  async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const token = sessionToken(request);
    if (!token) { await reply.code(401).send({ error: 'Sesión requerida' }); return; }
    const result = await pool.query<Principal>(`SELECT u.id, u.organization_id, u.role, u.display_name
      FROM auth_sessions s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = u.organization_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active' AND o.status = 'active'
        AND (u.role <> 'admin' OR (u.mfa_secret_encrypted IS NOT NULL AND s.mfa_verified))`, [digest(token)]);
    if (!result.rows[0]) { await reply.code(401).send({ error: 'Sesión inválida o vencida' }); return; }
    request.principal = result.rows[0];
  }
  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => ({ user: request.principal }));
  app.post('/api/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [digest(sessionToken(request)!)]);
    return reply.code(204).send();
  });
  app.get('/api/conversations', { preHandler: authenticate }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { search = '', channel = '', status = '', operator = '', limit = '20', offset = '0' } = query;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if ([search, channel, status, operator, limit, offset].some((value) => typeof value !== 'string') ||
      (search as string).length > 100 || (channel !== '' && !uuid.test(channel as string)) ||
      (operator !== '' && operator !== 'unassigned' && !uuid.test(operator as string)) ||
      (status !== '' && !['open', 'pending', 'resolved', 'spam'].includes(status as string)) ||
      !/^\d+$/.test(limit as string) || Number(limit) < 1 || Number(limit) > 100 ||
      !/^\d+$/.test(offset as string) || Number(offset) > 100000) return reply.code(400).send({ error: 'Filtros inválidos' });
    const result = await pool.query(`SELECT c.id,c.channel_account_id,c.contact_id,c.kind,c.status,c.last_message_at,c.assigned_user_id,
      COALESCE(contact.display_name, c.external_id) AS contact_name, contact.phone_number AS contact_phone,
      account.display_name AS channel_name, account.phone_number AS channel_phone, operator.display_name AS operator_name,
      last.body AS last_message,last.message_type AS last_message_type,last.direction AS last_message_direction
      FROM conversations c
      JOIN channel_accounts account ON account.id=c.channel_account_id AND account.organization_id=c.organization_id
      LEFT JOIN contacts contact ON contact.id=c.contact_id AND contact.organization_id=c.organization_id
      LEFT JOIN users operator ON operator.id=c.assigned_user_id AND operator.organization_id=c.organization_id
      LEFT JOIN LATERAL (SELECT body,message_type,direction FROM messages m WHERE m.conversation_id=c.id AND m.organization_id=c.organization_id ORDER BY m.occurred_at DESC,m.id DESC LIMIT 1) last ON true
      WHERE c.organization_id=$1 AND ($2='' OR position(lower($2) in lower(concat_ws(' ',contact.display_name,contact.phone_number,c.external_id)))>0)
      AND ($3='' OR c.channel_account_id::text=$3) AND ($4='' OR c.status=$4)
      AND ($5='' OR ($5='unassigned' AND c.assigned_user_id IS NULL) OR c.assigned_user_id::text=$5)
      ORDER BY c.last_message_at DESC NULLS LAST,c.id DESC LIMIT $6 OFFSET $7`,
    [request.principal!.organization_id, (search as string).trim(), channel, status, operator, Number(limit) + 1, Number(offset)]);
    return { conversations: result.rows.slice(0, Number(limit)), hasMore: result.rows.length > Number(limit) };
  });
  app.get('/api/inbox/options', { preHandler: authenticate }, async (request) => {
    const org = request.principal!.organization_id;
    const [channels, operators] = await Promise.all([
      pool.query('SELECT id,display_name,phone_number FROM channel_accounts WHERE organization_id=$1 ORDER BY display_name,id', [org]),
      pool.query("SELECT id,display_name FROM users WHERE organization_id=$1 AND status='active' ORDER BY display_name,id", [org]),
    ]);
    return { channels: channels.rows, operators: operators.rows };
  });
  app.get('/api/channels', { preHandler: authenticate }, async (request, reply) => {
    if (request.principal!.role !== 'admin') return reply.code(403).send({ error: 'Permiso denegado' });
    const result = await pool.query<{ id: string; connection_type: string; connection_status: string }>('SELECT id, phone_number, display_name, connection_status, connection_type FROM channel_accounts WHERE organization_id = $1', [request.principal!.organization_id]);
    return { channels: result.rows.map((channel) => channel.connection_type === 'whatsapp_web' ? { ...channel, connection_status: whatsapp.get(channel.id).state === 'disconnected' && channel.connection_status === 'revoked' ? 'revoked' : whatsapp.get(channel.id).state } : channel) };
  });
  async function admin(request: FastifyRequest, reply: FastifyReply) {
    await authenticate(request, reply);
    if (!reply.sent && request.principal?.role !== 'admin') await reply.code(403).send({ error: 'Permiso denegado' });
  }
  app.post('/api/channels', { preHandler: admin }, async (request, reply) => {
    const body = request.body as { displayName?: unknown } | null;
    if (typeof body?.displayName !== 'string' || !body.displayName.trim() || body.displayName.length > 100) return reply.code(400).send({ error: 'Nombre inválido' });
    const result = await pool.query<{ id: string }>("INSERT INTO channel_accounts (organization_id, display_name, connection_type, connection_status, created_by_user_id) VALUES ($1,$2,'whatsapp_web','disconnected',$3) RETURNING id", [request.principal!.organization_id, body.displayName.trim(), request.principal!.id]);
    return reply.code(201).send({ id: result.rows[0]!.id });
  });
  async function ownChannel(request: FastifyRequest, reply: FastifyReply) {
    const id = (request.params as { id: string }).id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { await reply.code(404).send({ error: 'Canal no encontrado' }); return; }
    const result = await pool.query("SELECT id FROM channel_accounts WHERE id=$1 AND organization_id=$2 AND connection_type='whatsapp_web'", [id, request.principal!.organization_id]);
    if (!result.rowCount) await reply.code(404).send({ error: 'Canal no encontrado' });
  }
  app.post('/api/channels/:id/connect', { preHandler: [admin, ownChannel] }, async (request, reply) => {
    try { await whatsapp.start((request.params as { id: string }).id); return reply.code(202).send({ status: 'starting' }); }
    catch { return reply.code(503).send({ error: 'No se pudo iniciar la conexión. Revisá la configuración del servidor.' }); }
  });
  app.get('/api/channels/:id/connection', { preHandler: [admin, ownChannel] }, async (request, reply) => {
    const result = whatsapp.get((request.params as { id: string }).id);
    reply.header('Cache-Control', 'no-store');
    return { status: result.state, qr: result.qr ? await QRCode.toDataURL(result.qr, { errorCorrectionLevel: 'M' }) : null };
  });
  app.post('/api/channels/:id/disconnect', { preHandler: [admin, ownChannel] }, async (request, reply) => {
    try { await whatsapp.disconnect((request.params as { id: string }).id); return reply.code(204).send(); }
    catch { return reply.code(409).send({ error: 'No se pudo desvincular. Comprobá el estado e intentá nuevamente.' }); }
  });
}
