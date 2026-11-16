import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMessageStatus } from '../src/whatsapp/message-status.js';

test('reconoce solo estados de entrega soportados', () => {
  assert.equal(normalizeMessageStatus(1), 'pending');
  assert.equal(normalizeMessageStatus(2), 'sent');
  assert.equal(normalizeMessageStatus(3), 'delivered');
  assert.equal(normalizeMessageStatus(4), 'read');
  assert.equal(normalizeMessageStatus(5), 'played');
  assert.equal(normalizeMessageStatus(0), null);
  assert.equal(normalizeMessageStatus(999), null);
});
