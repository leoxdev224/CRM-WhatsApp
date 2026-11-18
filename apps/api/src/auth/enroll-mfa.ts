import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pg from 'pg';
import { createSecret, encryptSecret, verifyCode } from './totp.js';

const email = process.env.CRM_USER_EMAIL?.trim().toLowerCase();
const actorId = process.env.CRM_AUDIT_ACTOR_ID;
if (!actorId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)) throw new Error('Configurá CRM_AUDIT_ACTOR_ID con el identificador del administrador responsable.');
if (!email) throw new Error('Configurá CRM_USER_EMAIL.');
const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
const terminal = createInterface({ input: stdin, output: stdout });
try {
  const user = await pool.query<{ id: string; organization_id: string }>("SELECT id, organization_id FROM users WHERE lower(email) = $1 AND role = 'admin' AND status = 'active'", [email]);
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
    const actor = await client.query("SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND role='admin' AND status='active'", [actorId, user.rows[0].organization_id]);
    if (!actor.rowCount) throw new Error('Administrador responsable no válido para esta organización.');
    await client.query("INSERT INTO security_audit (organization_id,actor_id,action,target_id,http_status) VALUES ($1,$2,'credential.mfa_reset',$3,200)", [user.rows[0].organization_id, actorId, user.rows[0].id]);
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [user.rows[0].id]);
    await client.query('COMMIT');
    console.log('Doble factor activado; sesiones anteriores revocadas.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} catch { console.error('No se pudo actualizar el doble factor.'); process.exitCode = 1; } finally { terminal.close(); await pool.end(); }
