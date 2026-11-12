import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { verifyPassword } from './password.js';
import { decryptSecret, verifyCode } from './totp.js';

type Principal = { id: string; organization_id: string; role: 'admin' | 'operator'; display_name: string };
declare module 'fastify' { interface FastifyRequest { principal: Principal | null } }

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sessionToken = (request: FastifyRequest) => {
  const match = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/);
  return match?.[1];
};

export function registerAuth(app: FastifyInstance, pool: Pool) {
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
  app.get('/api/conversations', { preHandler: authenticate }, async (request) => {
    const result = await pool.query('SELECT id, channel_account_id, contact_id, status, last_message_at FROM conversations WHERE organization_id = $1 ORDER BY last_message_at DESC NULLS LAST LIMIT 100', [request.principal!.organization_id]);
    return { conversations: result.rows };
  });
  app.get('/api/channels', { preHandler: authenticate }, async (request, reply) => {
    if (request.principal!.role !== 'admin') return reply.code(403).send({ error: 'Permiso denegado' });
    const result = await pool.query('SELECT id, phone_number, display_name, connection_status FROM channel_accounts WHERE organization_id = $1', [request.principal!.organization_id]);
    return { channels: result.rows };
  });
}
