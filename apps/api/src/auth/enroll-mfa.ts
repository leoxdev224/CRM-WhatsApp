import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pg from 'pg';
import { createSecret, encryptSecret, verifyCode } from './totp.js';

const email = process.env.CRM_USER_EMAIL?.trim().toLowerCase();
if (!email) throw new Error('Configurá CRM_USER_EMAIL.');
const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
const terminal = createInterface({ input: stdin, output: stdout });
try {
  const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = $1 AND role = 'admin' AND status = 'active'", [email]);
  if (!user.rows[0]) throw new Error('Administrador activo no encontrado.');
  const secret = createSecret();
  const encrypted = encryptSecret(secret);
  console.log(`Agregá una cuenta manualmente en tu aplicación autenticadora. Clave: ${secret}`);
  const code = await terminal.question('Código de seis dígitos: ');
  const counter = verifyCode(secret, code.trim());
  if (counter === null) throw new Error('Código inválido; no se modificó la cuenta.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query("UPDATE users SET mfa_secret_encrypted = $1, mfa_last_counter = $2 WHERE id = $3 AND role = 'admin' AND status = 'active'", [encrypted, counter, user.rows[0].id]);
    if (result.rowCount !== 1) throw new Error('El administrador ya no está disponible.');
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [user.rows[0].id]);
    await client.query('COMMIT');
    console.log('Doble factor activado; sesiones anteriores revocadas.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} finally { terminal.close(); await pool.end(); }
