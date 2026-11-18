import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { codeAt, decryptSecret, encryptSecret, createSecret } from '../src/auth/totp.js';
import { hashPassword } from '../src/auth/password.js';

const testKey = 'ab'.repeat(32);
const password = 'clave ficticia para pruebas';
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });
const cli = (name: string) => fileURLToPath(new URL(`../src/auth/${name}.ts`, import.meta.url));

async function enroll(env: NodeJS.ProcessEnv, valid: boolean): Promise<{ code: number | null; secret: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cli('enroll-mfa')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', secret = '', answered = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('La configuración del autenticador no respondió')); }, 15000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Clave: ([A-Z2-7]{32})\r?\n/);
      if (match && !answered) {
        secret = match[1]!; answered = true;
        child.stdin.end(`${valid ? codeAt(secret, Math.floor(Date.now() / 30000)) : 'incorrecto'}\n`);
      }
    });
    child.stderr.resume();
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, secret }); });
  });
}

test('alta y recuperación de administrador exigen TOTP y revocan sesiones', async (t) => {
  process.env.MFA_ENCRYPTION_KEY = testKey;
  const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
  const app = buildApp(pool);
  const org = randomUUID(), admin = randomUUID(), email = `${admin}@example.test`;
  t.after(async () => {
    await pool.query('DELETE FROM auth_login_attempts WHERE identity_hash=$1', [tokenHash(email)]);
    await pool.query('DELETE FROM security_audit WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM users WHERE id=$1', [admin]);
    await pool.query('DELETE FROM organizations WHERE id=$1', [org]);
    await app.close();
  });
  await pool.query('INSERT INTO organizations(id,name,slug) VALUES ($1,$1::uuid::text,$1::uuid::text)', [org]);
  await pool.query("INSERT INTO users(id,organization_id,email,display_name,role) VALUES ($1,$2,$3,'Admin de prueba','admin')", [admin,org,email]);
  const env = { ...process.env, MFA_ENCRYPTION_KEY: testKey, CRM_USER_EMAIL: email, CRM_USER_PASSWORD: password, CRM_AUDIT_ACTOR_ID: admin };
  const setPassword = spawnSync(process.execPath, ['--import', 'tsx', cli('set-password')], { env, encoding: 'utf8' });
  assert.equal(setPassword.status, 0);
  const login = (code?: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password, code } });
  assert.equal((await login()).statusCode, 401);
  const failedEnrollment = await enroll(env, false);
  assert.notEqual(failedEnrollment.code, 0);
  assert.equal((await pool.query('SELECT mfa_secret_encrypted FROM users WHERE id=$1', [admin])).rows[0].mfa_secret_encrypted, null);
  const enrolled = await enroll(env, true);
  assert.equal(enrolled.code, 0);
  const stored = await pool.query<{ mfa_secret_encrypted: string; mfa_last_counter: string }>('SELECT mfa_secret_encrypted,mfa_last_counter FROM users WHERE id=$1', [admin]);
  assert.equal(decryptSecret(stored.rows[0]!.mfa_secret_encrypted), enrolled.secret);
  assert.notEqual(stored.rows[0]!.mfa_secret_encrypted.includes(enrolled.secret), true);
  assert.equal((await login()).statusCode, 401);
  assert.equal((await login('0000000')).statusCode, 401);
  assert.equal((await login(codeAt(enrolled.secret, Number(stored.rows[0]!.mfa_last_counter)))).statusCode, 401);
  const currentCounter = Math.floor(Date.now() / 30000);
  const nextCounter = Number(stored.rows[0]!.mfa_last_counter) + 1;
  assert.ok(nextCounter <= currentCounter + 1);
  const code = codeAt(enrolled.secret, nextCounter);
  const success = await login(code);
  assert.equal(success.statusCode, 200);
  const token = success.json().token as string;
  const withoutMfa = randomBytes(32).toString('hex');
  await pool.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at,mfa_verified) VALUES ($1,$2,now()+interval '1 hour',false)", [tokenHash(withoutMfa),admin]);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(withoutMfa) })).statusCode, 401);
  assert.equal((await login(code)).statusCode, 401);
  const invalidRecovery = await enroll(env, false);
  assert.notEqual(invalidRecovery.code, 0);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(token) })).statusCode, 200);
  const beforeRecovery = await pool.query<{ mfa_secret_encrypted: string }>('SELECT mfa_secret_encrypted FROM users WHERE id=$1', [admin]);
  assert.equal(decryptSecret(beforeRecovery.rows[0]!.mfa_secret_encrypted), enrolled.secret);
  const recovery = await enroll(env, true);
  assert.equal(recovery.code, 0);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(token) })).statusCode, 401);
  const reset = await pool.query<{ mfa_secret_encrypted: string }>('SELECT mfa_secret_encrypted FROM users WHERE id=$1', [admin]);
  assert.equal(decryptSecret(reset.rows[0]!.mfa_secret_encrypted), recovery.secret);
  assert.equal((await pool.query("SELECT 1 FROM security_audit WHERE organization_id=$1 AND actor_id=$2 AND target_id=$2 AND action='credential.mfa_reset'", [org,admin])).rowCount, 2);
});

test('el bloqueo temporal y el vencimiento de sesión se aplican en el servidor', async (t) => {
  const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
  const app = buildApp(pool);
  const org = randomUUID(), user = randomUUID(), email = `${user}@example.test`;
  t.after(async () => {
    await pool.query('DELETE FROM auth_login_attempts WHERE identity_hash=$1', [tokenHash(email)]);
    await pool.query('DELETE FROM security_audit WHERE organization_id=$1', [org]);
    await pool.query('DELETE FROM users WHERE id=$1', [user]);
    await pool.query('DELETE FROM organizations WHERE id=$1', [org]);
    await app.close();
  });
  await pool.query('INSERT INTO organizations(id,name,slug) VALUES ($1,$1::uuid::text,$1::uuid::text)', [org]);
  await pool.query("INSERT INTO users(id,organization_id,email,display_name,role,password_hash) VALUES ($1,$2,$3,'Operador','operator',$4)", [user,org,email,await hashPassword(password)]);
  const login = (pass: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: pass } });
  for (let i=0; i<5; i++) assert.equal((await login('clave incorrecta')).statusCode, 401);
  assert.equal((await login(password)).statusCode, 429);
  await pool.query("UPDATE auth_login_attempts SET locked_until=now()-interval '1 second' WHERE identity_hash=$1", [tokenHash(email)]);
  const response = await login(password); assert.equal(response.statusCode, 200);
  const token = response.json().token as string;
  const lifetime = await pool.query<{ seconds: string }>('SELECT EXTRACT(EPOCH FROM expires_at-created_at) AS seconds FROM auth_sessions WHERE token_hash=$1', [tokenHash(token)]);
  assert.equal(Number(lifetime.rows[0]!.seconds), 28800);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(token) })).statusCode, 200);
  await pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [tokenHash(token)]);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(token) })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: authHeader(token) })).statusCode, 401);
  const again = await login(password); assert.equal(again.statusCode, 200);
  const newToken = again.json().token as string;
  await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [user]);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(newToken) })).statusCode, 401);
  await pool.query("UPDATE users SET status='active' WHERE id=$1", [user]);
  await pool.query("UPDATE organizations SET status='disabled' WHERE id=$1", [org]);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(newToken) })).statusCode, 401);
  await pool.query("UPDATE organizations SET status='active' WHERE id=$1", [org]);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: authHeader(newToken) })).statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(newToken) })).statusCode, 401);
});

test('lecturas y escrituras respetan roles y organizaciones', async (t) => {
  process.env.MFA_ENCRYPTION_KEY = testKey;
  const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
  const app = buildApp(pool);
  const org = randomUUID(), other = randomUUID(), operator = randomUUID(), admin = randomUUID(), foreignUser = randomUUID();
  const channel = randomUUID(), foreignChannel = randomUUID(), conv = randomUUID(), foreignConv = randomUUID();
  const operatorToken = randomBytes(32).toString('hex'), adminToken = randomBytes(32).toString('hex');
  t.after(async () => {
    await pool.query('DELETE FROM security_audit WHERE organization_id=ANY($1::uuid[])', [[org,other]]);
    await pool.query('DELETE FROM messages WHERE organization_id=ANY($1::uuid[])', [[org,other]]);
    await pool.query('DELETE FROM conversations WHERE organization_id=ANY($1::uuid[])', [[org,other]]);
    await pool.query('DELETE FROM channel_accounts WHERE organization_id=ANY($1::uuid[])', [[org,other]]);
    await pool.query('DELETE FROM users WHERE organization_id=ANY($1::uuid[])', [[org,other]]);
    await pool.query('DELETE FROM organizations WHERE id=ANY($1::uuid[])', [[org,other]]);
    await app.close();
  });
  await pool.query('INSERT INTO organizations(id,name,slug) VALUES ($1,$1::uuid::text,$1::uuid::text),($2,$2::uuid::text,$2::uuid::text)', [org,other]);
  await pool.query("INSERT INTO users(id,organization_id,email,display_name,role,mfa_secret_encrypted) VALUES ($1,$4,$1::uuid::text||'@example.test','Operador','operator',NULL),($2,$4,$2::uuid::text||'@example.test','Admin','admin',$6),($3,$5,$3::uuid::text||'@example.test','Externo','operator',NULL)", [operator,admin,foreignUser,org,other,encryptSecret(createSecret())]);
  await pool.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at,mfa_verified) VALUES ($1,$3,now()+interval '1 hour',false),($2,$4,now()+interval '1 hour',true)", [tokenHash(operatorToken),tokenHash(adminToken),operator,admin]);
  await pool.query("INSERT INTO channel_accounts(id,organization_id,display_name,phone_number,connection_type) VALUES ($1,$3,'Local','+5491100080001','whatsapp_web'),($2,$4,'Externo','+5491100080002','whatsapp_web')", [channel,foreignChannel,org,other]);
  await pool.query("INSERT INTO conversations(id,organization_id,channel_account_id,kind,external_id) VALUES ($1,$3,$5,'group','local@g.us'),($2,$4,$6,'group','extranjero@g.us')", [conv,foreignConv,org,other,channel,foreignChannel]);
  const op = authHeader(operatorToken), adm = authHeader(adminToken);
  assert.equal((await app.inject({ method: 'GET', url: `/api/conversations/${conv}/messages`, headers: op })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/conversations/${conv}`, headers: op, payload: { status: 'pending', assignedUserId: operator } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `/api/conversations/${conv}/notes`, headers: op, payload: { body: 'Nota local' } })).statusCode, 201);
  assert.equal((await app.inject({ method: 'GET', url: `/api/conversations/${conv}/notes`, headers: adm })).json().notes.length, 1);
  assert.equal((await app.inject({ method: 'GET', url: `/api/conversations/${conv}/activity`, headers: op })).json().activity.length, 2);
  assert.equal((await app.inject({ method: 'GET', url: '/api/channels', headers: op })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/channels', headers: op, payload: { displayName: 'Inválido' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/audit', headers: op })).statusCode, 403);
  for (const headers of [op, adm]) {
    for (const section of ['messages','notes','activity']) assert.equal((await app.inject({ method: 'GET', url: `/api/conversations/${foreignConv}/${section}`, headers })).statusCode, 404);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/conversations/${foreignConv}`, headers, payload: { status: 'resolved' } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: `/api/conversations/${foreignConv}/notes`, headers, payload: { body: 'Privado' } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: `/api/conversations/${foreignConv}/messages`, headers, payload: { id: randomUUID(), text: 'Privado' } })).statusCode, 404);
  }
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/conversations/${conv}`, headers: op, payload: { assignedUserId: foreignUser } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/api/channels/${foreignChannel}/disconnect`, headers: adm })).statusCode, 404);
  const inbox = (await app.inject({ method: 'GET', url: '/api/conversations', headers: op })).json();
  assert.deepEqual(inbox.conversations.map((item: { id: string }) => item.id), [conv]);
  const options = (await app.inject({ method: 'GET', url: '/api/inbox/options', headers: op })).json();
  assert.ok(options.channels.every((item: { id: string }) => item.id !== foreignChannel));
  assert.ok(options.operators.every((item: { id: string }) => item.id !== foreignUser));
});
