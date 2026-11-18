import pg from 'pg';
import { hashPassword } from './password.js';

const email = process.env.CRM_USER_EMAIL?.trim().toLowerCase();
const password = process.env.CRM_USER_PASSWORD;
const actorId = process.env.CRM_AUDIT_ACTOR_ID;
if (!actorId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)) throw new Error('Configurá CRM_AUDIT_ACTOR_ID con el identificador del administrador responsable.');
if (!email || !password || password.length < 12 || password.length > 1024) {
  throw new Error('Configurá CRM_USER_EMAIL y CRM_USER_PASSWORD (mínimo 12 caracteres).');
}
const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
try {
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('UPDATE users SET password_hash = $1 WHERE lower(email) = $2 RETURNING id, organization_id', [hash, email]);
    if (result.rowCount !== 1) throw new Error('Usuario no encontrado.');
    const actor = await client.query("SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND role='admin' AND status='active'", [actorId, result.rows[0].organization_id]);
    if (!actor.rowCount) throw new Error('Administrador responsable no válido para esta organización.');
    await client.query("INSERT INTO security_audit (organization_id,actor_id,action,target_id,http_status) VALUES ($1,$2,'credential.password_reset',$3,200)", [result.rows[0].organization_id, actorId, result.rows[0].id]);
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [result.rows[0].id]);
    await client.query('DELETE FROM auth_login_attempts WHERE identity_hash = encode(sha256(convert_to($1, \'UTF8\')), \'hex\')', [email]);
    await client.query('COMMIT');
    console.log('Contraseña actualizada y sesiones revocadas.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} catch { console.error('No se pudo actualizar la contraseña.'); process.exitCode = 1; } finally { await pool.end(); }
