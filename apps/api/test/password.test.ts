import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

test('contraseñas se almacenan con salt y solo verifican la contraseña correcta', async () => {
  const hash = await hashPassword('contraseña de prueba larga');
  assert.notEqual(hash, await hashPassword('contraseña de prueba larga'));
  assert.equal(await verifyPassword('contraseña de prueba larga', hash), true);
  assert.equal(await verifyPassword('incorrecta', hash), false);
  assert.equal(await verifyPassword('cualquiera', 'hash-inválido'), false);
});
