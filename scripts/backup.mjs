import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

const [mode, container, dbUser, database, file] = process.argv.slice(2);
const key = process.env.CRM_BACKUP_KEY;
const magic = Buffer.from('CRMDB01');
if (!['backup', 'restore'].includes(mode ?? '') || !container || !dbUser || !database || !file || !file.endsWith('.crmbackup') || !/^[a-zA-Z0-9_-]+$/.test(container) || !/^[a-zA-Z0-9_]+$/.test(dbUser) || !/^[a-zA-Z0-9_]+$/.test(database) || !key || !/^[a-fA-F0-9]{64}$/.test(key)) {
  throw new Error('Uso: node scripts/backup.mjs backup|restore CONTENEDOR USUARIO BASE ARCHIVO; configurar CRM_BACKUP_KEY como 64 dígitos hexadecimales.');
}
const secret = Buffer.from(key, 'hex');
function docker(args, input) {
  const child = spawn('docker', ['exec', '-i', container, ...args], { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  const stderr = []; child.stderr.on('data', (chunk) => stderr.push(chunk));
  const done = new Promise((resolveDone, reject) => {
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolveDone() : reject(new Error('Falló el comando PostgreSQL en el contenedor.')));
  });
  return { child, done };
}
async function collect(stream) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); }
const output = resolve(file);
if (mode === 'backup') {
  const handle = await open(output, 'wx', 0o600);
  const iv = randomBytes(12);
  let complete = false;
  try {
    await handle.write(Buffer.concat([magic, iv]));
    const cipher = createCipheriv('aes-256-gcm', secret, iv);
    const { child, done } = docker(['pg_dump', '-U', dbUser, '-d', database, '-Fc', '--no-owner', '--no-acl']);
    await Promise.all([pipeline(child.stdout, cipher, createWriteStream(output, { flags: 'a' })), done]);
    await handle.write(cipher.getAuthTag(), 0, 16, (await handle.stat()).size);
    complete = true;
  } finally { await handle.close(); if (!complete) await rm(output, { force: true }); }
  console.log('Copia cifrada creada.');
} else {
  if (!database.endsWith('_restore')) throw new Error('La base de destino debe terminar en _restore y estar vacía.');
  const check = docker(['psql', '-U', dbUser, '-d', database, '-At', '-c', "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')"]);
  const [count] = await Promise.all([collect(check.child.stdout), check.done]);
  if (count.toString().trim() !== '0') throw new Error('La base de destino no está vacía.');
  const source = await open(output, 'r');
  const dir = await mkdtemp(join(tmpdir(), 'crm-restore-'));
  const temporary = join(dir, 'restore.dump');
  try {
    const size = (await source.stat()).size;
    if (size < magic.length + 12 + 16 + 1) throw new Error('Archivo de copia inválido.');
    const header = Buffer.alloc(magic.length + 12), tag = Buffer.alloc(16);
    await source.read(header, 0, header.length, 0); await source.read(tag, 0, 16, size - 16);
    if (!header.subarray(0, magic.length).equals(magic)) throw new Error('Formato de copia inválido.');
    const decipher = createDecipheriv('aes-256-gcm', secret, header.subarray(magic.length)); decipher.setAuthTag(tag);
    await pipeline(createReadStream(output, { start: header.length, end: size - 17 }), decipher, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const restore = docker(['pg_restore', '-U', dbUser, '-d', database, '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl'], true);
    await Promise.all([pipeline(createReadStream(temporary), restore.child.stdin), collect(restore.child.stdout), restore.done]);
    console.log('Copia restaurada en la base vacía de prueba.');
  } finally { await source.close(); await rm(temporary, { force: true }); await rmdir(dir); }
}
