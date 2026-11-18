import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const container = process.env.CRM_TEST_BACKUP_CONTAINER;
test('copia cifrada y restauración segura con PostgreSQL de prueba', { skip: !container }, () => {
  const suffix = randomBytes(6).toString('hex');
  const source = `crmtest_${suffix}`, target = `${source}_restore`, damaged = `${source}_bad_restore`;
  const folder = mkdtempSync(join(tmpdir(), 'crm011-test-'));
  const backup = join(folder, 'backup.crmbackup'), corrupt = join(folder, 'corrupt.crmbackup');
  const key = randomBytes(32).toString('hex');
  const db = (...args) => spawnSync('docker', ['exec', container, ...args], { encoding: 'utf8' });
  const run = (mode, database, path, backupKey = key) => spawnSync(process.execPath, ['scripts/backup.mjs', mode, container, 'crm_test', database, path], { encoding: 'utf8', env: { ...process.env, CRM_BACKUP_KEY: backupKey } });
  const created = [];
  try {
    for (const name of [source, target, damaged]) { const result = db('createdb', '-U', 'crm_test', name); assert.equal(result.status, 0, result.stderr); created.push(name); }
    assert.equal(db('psql', '-U', 'crm_test', '-d', source, '-c', "CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES ('contenido ficticio');").status, 0);
    let result = run('backup', source, backup); assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(backup).includes(Buffer.from('contenido ficticio')), false);
    assert.notEqual(run('backup', source, backup).status, 0);
    const bytes = readFileSync(backup); bytes[bytes.length - 1] ^= 1; writeFileSync(corrupt, bytes);
    assert.notEqual(run('restore', damaged, corrupt).status, 0);
    assert.notEqual(run('restore', damaged, backup, randomBytes(32).toString('hex')).status, 0);
    assert.equal(db('psql', '-U', 'crm_test', '-d', damaged, '-At', '-c', "SELECT count(*) FROM pg_tables WHERE schemaname='public'").stdout.trim(), '0');
    result = run('restore', target, backup); assert.equal(result.status, 0, result.stderr);
    assert.equal(db('psql', '-U', 'crm_test', '-d', target, '-At', '-c', 'SELECT value FROM fixture').stdout.trim(), 'contenido ficticio');
    assert.notEqual(run('restore', target, backup).status, 0);
    assert.notEqual(run('restore', source, backup).status, 0);
  } finally {
    for (const name of created) db('dropdb', '-U', 'crm_test', name);
    rmSync(backup, { force: true }); rmSync(corrupt, { force: true }); rmdirSync(folder);
  }
});
