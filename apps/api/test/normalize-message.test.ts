import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMessage } from '../src/whatsapp/normalize-message.js';

test('distingue mensajes individuales y grupos sin atribuir grupos a contactos', () => {
  const individual = normalizeMessage({ key: { id: 'id-1', remoteJid: '1234567@s.whatsapp.net', fromMe: false }, messageTimestamp: 1700000000, message: { conversation: 'Hola' } });
  assert.equal(individual?.kind, 'individual');
  assert.equal(individual?.body, 'Hola');
  const group = normalizeMessage({ key: { id: 'id-2', remoteJid: '123@g.us', participant: '456@s.whatsapp.net', fromMe: false }, messageTimestamp: 1700000000, message: { conversation: 'Hola grupo' } });
  assert.equal(group?.kind, 'group');
  assert.equal(group?.senderId, '456@s.whatsapp.net');
  assert.equal(normalizeMessage({ key: { id: 'id-3', remoteJid: '123@g.us', fromMe: false }, messageTimestamp: 1700000000, message: { conversation: 'sin autor' } }), null);
  assert.equal(normalizeMessage({ key: { id: 'id-4', remoteJid: 'status@broadcast', fromMe: false }, messageTimestamp: 1700000000, message: { conversation: 'estado' } }), null);
});
