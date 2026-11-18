import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeAt, verifyCode, createSecret, encryptSecret, decryptSecret } from '../src/auth/totp.js';

test('TOTP valida códigos y rechaza códigos inválidos', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(codeAt(secret, 1), '287082');
  assert.equal(verifyCode(secret, '287082', 59000), 1);
  assert.equal(verifyCode(secret, '000000', 59000), null);
});

test('el secreto se cifra y no se puede alterar', () => {
  process.env.MFA_ENCRYPTION_KEY = 'aa'.repeat(32);
  const secret = createSecret();
  const encrypted = encryptSecret(secret);
  assert.equal(decryptSecret(encrypted), secret);
  const [iv, tag, data] = encrypted.split(':');
  const changed = data!.slice(-2) === '00' ? '01' : '00';
  assert.throws(() => decryptSecret(`${iv}:${tag}:${data!.slice(0, -2)}${changed}`));
});

test('TOTP coincide con los vectores de interoperabilidad RFC 6238', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']] as const) {
    assert.equal(codeAt(secret, Math.floor(seconds / 30)), expected);
  }
});
