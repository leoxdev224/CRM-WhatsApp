CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE channel_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'whatsapp' CHECK (provider = 'whatsapp'),
  provider_account_id TEXT,
  phone_number TEXT NOT NULL CHECK (phone_number ~ '^\+[1-9][0-9]{6,14}$'),
  display_name TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'awaiting_qr'
    CHECK (connection_status IN ('awaiting_qr', 'connected', 'disconnected', 'revoked')),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX channel_accounts_phone_number_unique ON channel_accounts (phone_number);
CREATE UNIQUE INDEX channel_accounts_provider_external_unique
  ON channel_accounts (provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{6,14}$'),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX contacts_phone_number_unique
  ON contacts (phone_number)
  WHERE phone_number IS NOT NULL;

CREATE TABLE contact_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel_account_id UUID NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL CHECK (length(btrim(external_id)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_account_id, external_id)
);

CREATE INDEX contact_identities_contact_id_index ON contact_identities (contact_id);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id UUID NOT NULL REFERENCES channel_accounts(id) ON DELETE RESTRICT,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  external_id TEXT NOT NULL CHECK (length(btrim(external_id)) > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'spam')),
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_account_id, external_id),
  UNIQUE (id, channel_account_id)
);

CREATE INDEX conversations_contact_id_index ON conversations (contact_id);
CREATE INDEX conversations_inbox_index ON conversations (channel_account_id, status, last_message_at DESC NULLS LAST);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  channel_account_id UUID NOT NULL,
  provider_message_id TEXT NOT NULL CHECK (length(btrim(provider_message_id)) > 0),
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contact', 'system')),
  body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, channel_account_id)
    REFERENCES conversations (id, channel_account_id) ON DELETE RESTRICT,
  UNIQUE (channel_account_id, provider_message_id)
);

CREATE INDEX messages_conversation_timeline_index ON messages (conversation_id, occurred_at, id);

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER channel_accounts_set_updated_at BEFORE UPDATE ON channel_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
