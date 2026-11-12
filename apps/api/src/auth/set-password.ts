import pg from 'pg';
import { hashPassword } from './password.js';

const email = process.env.CRM_USER_EMAIL?.trim().toLowerCase();
const password = process.env.CRM_USER_PASSWORD;
if (!email || !password || password.length < 12 || password.length > 1024) {
  throw new Error('Configurá CRM_USER_EMAIL y CRM_USER_PASSWORD (mínimo 12 caracteres).');
}
const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
try {
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('UPDATE users SET password_hash = $1 WHERE lower(email) = $2 RETURNING id', [hash, email]);
    if (result.rowCount !== 1) throw new Error('Usuario no encontrado.');
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [result.rows[0].id]);
    await client.query('DELETE FROM auth_login_attempts WHERE identity_hash = encode(sha256(convert_to($1, \'UTF8\')), \'hex\')', [email]);
    await client.query('COMMIT');
    console.log('Contraseña actualizada y sesiones revocadas.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} finally { await pool.end(); }
