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

  const organization = await pool.query<{ name: string; slug: string }>(`
    SELECT organizations.name, organizations.slug
    FROM conversations
    JOIN organizations ON organizations.id = conversations.organization_id
    WHERE conversations.id = '77777777-7777-4777-8777-777777777771'
  `);
  assert.deepEqual(organization.rows, [{ name: 'CityWin', slug: 'citywin' }]);

  await pool.query(
    "INSERT INTO organizations (id, name, slug) VALUES " +
    "('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Otra empresa', 'otra-empresa') " +
    "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug",
  );
  await pool.query(
    "INSERT INTO users (id, organization_id, email, display_name) VALUES " +
    "('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', " +
      "'operador-externo@example.test', 'Operador externo') " +
      "ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id",
  );
  await pool.query(
      "INSERT INTO contacts (id, organization_id, phone_number, display_name) VALUES " +
      "('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', " +
      "'+5491100001001', 'Contacto externo') ON CONFLICT (id) DO UPDATE SET " +
      "organization_id = EXCLUDED.organization_id, phone_number = EXCLUDED.phone_number",
  );
  const duplicatePhoneAcrossOrganizations = await pool.query<{ count: string }>(
    "SELECT count(*) FROM contacts WHERE phone_number = '+5491100001001'",
  );
  assert.deepEqual(duplicatePhoneAcrossOrganizations.rows, [{ count: '2' }]);

  await assert.rejects(
    pool.query(
      "UPDATE conversations SET assigned_user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' " +
      "WHERE id = '77777777-7777-4777-8777-777777777771'",
    ),
    /foreign key constraint/,
  );

  await assert.rejects(
    pool.query(
      "INSERT INTO contact_identities (organization_id, contact_id, channel_account_id, external_id) VALUES " +
      "('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', " +
      "'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '5491100001999@c.us')",
    ),
    /foreign key constraint/,
  );

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
      INSERT INTO messages (organization_id, conversation_id, channel_account_id, provider_message_id, direction, occurred_at)
      VALUES (
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        '77777777-7777-4777-8777-777777777771',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'wamid.test.cross-organization',
        'incoming',
        now()
      )
    `),
    /foreign key constraint/,
  );

  await assert.rejects(
    pool.query(`
      INSERT INTO messages (organization_id, conversation_id, channel_account_id, provider_message_id, direction, occurred_at)
      VALUES (
        '99999999-9999-4999-8999-999999999999',
        '77777777-7777-4777-8777-777777777771',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'wamid.test.cross-account',
        'incoming',
        now()
      )
    `),
    /foreign key constraint/,
  );

  await pool.query("DELETE FROM contacts WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'");
  await pool.query("DELETE FROM users WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'");
  await pool.query("DELETE FROM organizations WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'");

  await app.close();
  await assert.rejects(pool.query('SELECT 1'), /after calling end/);
});
