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
