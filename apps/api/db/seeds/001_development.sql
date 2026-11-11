INSERT INTO organizations (id, name, slug) VALUES
  ('99999999-9999-4999-8999-999999999999', 'CityWin', 'citywin')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug;

INSERT INTO users (id, organization_id, email, display_name, role) VALUES
  ('11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 'admin@example.test', 'Admin demo', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '99999999-9999-4999-8999-999999999999', 'operador@example.test', 'Operador demo', 'operator')
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role;

INSERT INTO channel_accounts (id, organization_id, provider, provider_account_id, phone_number, display_name, connection_status, created_by_user_id, connected_at) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999999', 'whatsapp', '5491100000001@c.us', '+5491100000001', 'Ventas Norte', 'connected', '11111111-1111-4111-8111-111111111111', TIMESTAMPTZ '2026-11-04 15:00:00-03'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '99999999-9999-4999-8999-999999999999', 'whatsapp', '5491100000002@c.us', '+5491100000002', 'Soporte Sur', 'connected', '11111111-1111-4111-8111-111111111111', TIMESTAMPTZ '2026-11-04 15:00:00-03')
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  provider_account_id = EXCLUDED.provider_account_id,
  phone_number = EXCLUDED.phone_number,
  display_name = EXCLUDED.display_name,
  connection_status = EXCLUDED.connection_status,
  connected_at = EXCLUDED.connected_at;

INSERT INTO contacts (id, organization_id, phone_number, display_name) VALUES
  ('33333333-3333-4333-8333-333333333333', '99999999-9999-4999-8999-999999999999', '+5491100001001', 'Ana Gómez'),
  ('44444444-4444-4444-8444-444444444444', '99999999-9999-4999-8999-999999999999', '+5491100001002', 'Bruno Díaz'),
  ('55555555-5555-4555-8555-555555555555', '99999999-9999-4999-8999-999999999999', '+5491100001003', 'Carla Ruiz')
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  phone_number = EXCLUDED.phone_number,
  display_name = EXCLUDED.display_name;

INSERT INTO contact_identities (id, organization_id, contact_id, channel_account_id, external_id) VALUES
  ('66666666-6666-4666-8666-666666666661', '99999999-9999-4999-8999-999999999999', '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '5491100001001@c.us'),
  ('66666666-6666-4666-8666-666666666662', '99999999-9999-4999-8999-999999999999', '33333333-3333-4333-8333-333333333333', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '5491100001001@c.us'),
  ('66666666-6666-4666-8666-666666666663', '99999999-9999-4999-8999-999999999999', '44444444-4444-4444-8444-444444444444', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '5491100001002@c.us'),
  ('66666666-6666-4666-8666-666666666664', '99999999-9999-4999-8999-999999999999', '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '5491100001003@c.us')
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  contact_id = EXCLUDED.contact_id,
  channel_account_id = EXCLUDED.channel_account_id,
  external_id = EXCLUDED.external_id;

INSERT INTO conversations (id, organization_id, channel_account_id, contact_id, external_id, status, assigned_user_id, last_message_at) VALUES
  ('77777777-7777-4777-8777-777777777771', '99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', '5491100001001@c.us', 'open', '22222222-2222-4222-8222-222222222222', TIMESTAMPTZ '2026-11-04 17:20:00-03'),
  ('77777777-7777-4777-8777-777777777772', '99999999-9999-4999-8999-999999999999', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '33333333-3333-4333-8333-333333333333', '5491100001001@c.us', 'pending', NULL, TIMESTAMPTZ '2026-11-04 17:12:00-03'),
  ('77777777-7777-4777-8777-777777777773', '99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', '5491100001003@c.us', 'resolved', '22222222-2222-4222-8222-222222222222', TIMESTAMPTZ '2026-11-04 16:55:00-03')
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  channel_account_id = EXCLUDED.channel_account_id,
  contact_id = EXCLUDED.contact_id,
  external_id = EXCLUDED.external_id,
  status = EXCLUDED.status,
  assigned_user_id = EXCLUDED.assigned_user_id,
  last_message_at = EXCLUDED.last_message_at;

INSERT INTO messages (id, organization_id, conversation_id, channel_account_id, provider_message_id, direction, message_type, body, occurred_at) VALUES
  ('88888888-8888-4888-8888-888888888881', '99999999-9999-4999-8999-999999999999', '77777777-7777-4777-8777-777777777771', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'wamid.seed.norte.1', 'incoming', 'text', 'Hola, quiero conocer los planes disponibles.', TIMESTAMPTZ '2026-11-04 17:18:00-03'),
  ('88888888-8888-4888-8888-888888888882', '99999999-9999-4999-8999-999999999999', '77777777-7777-4777-8777-777777777771', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'wamid.seed.norte.2', 'outgoing', 'text', '¡Hola Ana! Te comparto la información.', TIMESTAMPTZ '2026-11-04 17:20:00-03'),
  ('88888888-8888-4888-8888-888888888883', '99999999-9999-4999-8999-999999999999', '77777777-7777-4777-8777-777777777772', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'wamid.seed.sur.1', 'incoming', 'text', 'Necesito ayuda con mi cuenta.', TIMESTAMPTZ '2026-11-04 17:12:00-03'),
  ('88888888-8888-4888-8888-888888888884', '99999999-9999-4999-8999-999999999999', '77777777-7777-4777-8777-777777777773', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'wamid.seed.norte.3', 'outgoing', 'text', 'Tu consulta fue resuelta. Gracias por escribirnos.', TIMESTAMPTZ '2026-11-04 16:55:00-03')
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  conversation_id = EXCLUDED.conversation_id,
  channel_account_id = EXCLUDED.channel_account_id,
  provider_message_id = EXCLUDED.provider_message_id,
  direction = EXCLUDED.direction,
  message_type = EXCLUDED.message_type,
  body = EXCLUDED.body,
  occurred_at = EXCLUDED.occurred_at;
