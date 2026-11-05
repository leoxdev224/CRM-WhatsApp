import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../src/app.js';

test('ready comprueba una conexión real con PostgreSQL y cierra el pool al apagar', async (t) => {
  const pool = new pg.Pool({ connectionTimeoutMillis: 3000, query_timeout: 3000 });
  const app = buildApp(pool);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/api/ready' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', database: 'connected' });

  const seededConversation = await pool.query<{
    account: string;
    contact: string;
    provider_message_id: string;
  }>(`
    SELECT channel_accounts.phone_number AS account, contacts.phone_number AS contact, messages.provider_message_id
    FROM messages
    JOIN conversations ON conversations.id = messages.conversation_id
    JOIN channel_accounts ON channel_accounts.id = conversations.channel_account_id
    JOIN contacts ON contacts.id = conversations.contact_id
    WHERE messages.provider_message_id = 'wamid.seed.norte.2'
  `);
  assert.deepEqual(seededConversation.rows, [{
    account: '+5491100000001',
    contact: '+5491100001001',
    provider_message_id: 'wamid.seed.norte.2',
  }]);

  await assert.rejects(
    pool.query(`
      INSERT INTO messages (conversation_id, channel_account_id, provider_message_id, direction, occurred_at)
      VALUES (
        '77777777-7777-4777-8777-777777777771',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'wamid.test.cross-account',
        'incoming',
        now()
      )
    `),
    /foreign key constraint/,
  );

  await app.close();
  await assert.rejects(pool.query('SELECT 1'), /after calling end/);
});
