CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO organizations (id, name, slug)
VALUES ('99999999-9999-4999-8999-999999999999', 'CityWin', 'citywin');

ALTER TABLE users ADD COLUMN organization_id UUID;
ALTER TABLE channel_accounts ADD COLUMN organization_id UUID;
ALTER TABLE contacts ADD COLUMN organization_id UUID;
ALTER TABLE contact_identities ADD COLUMN organization_id UUID;
ALTER TABLE conversations ADD COLUMN organization_id UUID;
ALTER TABLE messages ADD COLUMN organization_id UUID;

UPDATE users SET organization_id = '99999999-9999-4999-8999-999999999999';
UPDATE channel_accounts SET organization_id = '99999999-9999-4999-8999-999999999999';
UPDATE contacts SET organization_id = '99999999-9999-4999-8999-999999999999';
UPDATE contact_identities SET organization_id = '99999999-9999-4999-8999-999999999999';
UPDATE conversations SET organization_id = '99999999-9999-4999-8999-999999999999';
UPDATE messages SET organization_id = '99999999-9999-4999-8999-999999999999';

ALTER TABLE users ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE channel_accounts ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE contacts ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE contact_identities ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE conversations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE messages ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE channel_accounts DROP CONSTRAINT IF EXISTS channel_accounts_created_by_user_id_fkey;
ALTER TABLE contact_identities DROP CONSTRAINT IF EXISTS contact_identities_contact_id_fkey;
ALTER TABLE contact_identities DROP CONSTRAINT IF EXISTS contact_identities_channel_account_id_fkey;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_account_id_fkey;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_contact_id_fkey;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_assigned_user_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_conversation_id_channel_account_id_fkey;

DROP INDEX channel_accounts_phone_number_unique;
DROP INDEX channel_accounts_provider_external_unique;
DROP INDEX contacts_phone_number_unique;
ALTER TABLE contact_identities DROP CONSTRAINT contact_identities_channel_account_id_external_id_key;
ALTER TABLE conversations DROP CONSTRAINT conversations_channel_account_id_external_id_key;
ALTER TABLE messages DROP CONSTRAINT messages_channel_account_id_provider_message_id_key;

ALTER TABLE users ADD CONSTRAINT users_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE channel_accounts ADD CONSTRAINT channel_accounts_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE contacts ADD CONSTRAINT contacts_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

ALTER TABLE users ADD CONSTRAINT users_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE channel_accounts ADD CONSTRAINT channel_accounts_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE contacts ADD CONSTRAINT contacts_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE conversations ADD CONSTRAINT conversations_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE conversations
  ADD CONSTRAINT conversations_id_channel_account_id_organization_id_key
  UNIQUE (id, channel_account_id, organization_id);

ALTER TABLE channel_accounts ADD CONSTRAINT channel_accounts_created_by_user_organization_fkey
  FOREIGN KEY (created_by_user_id, organization_id)
  REFERENCES users (id, organization_id) ON DELETE SET NULL (created_by_user_id);
ALTER TABLE contact_identities ADD CONSTRAINT contact_identities_contact_organization_fkey
  FOREIGN KEY (contact_id, organization_id)
  REFERENCES contacts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE contact_identities ADD CONSTRAINT contact_identities_account_organization_fkey
  FOREIGN KEY (channel_account_id, organization_id)
  REFERENCES channel_accounts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE conversations ADD CONSTRAINT conversations_account_organization_fkey
  FOREIGN KEY (channel_account_id, organization_id)
  REFERENCES channel_accounts (id, organization_id) ON DELETE RESTRICT;
ALTER TABLE conversations ADD CONSTRAINT conversations_contact_organization_fkey
  FOREIGN KEY (contact_id, organization_id)
  REFERENCES contacts (id, organization_id) ON DELETE RESTRICT;
ALTER TABLE conversations ADD CONSTRAINT conversations_assigned_user_organization_fkey
  FOREIGN KEY (assigned_user_id, organization_id)
  REFERENCES users (id, organization_id) ON DELETE SET NULL (assigned_user_id);
ALTER TABLE messages ADD CONSTRAINT messages_conversation_account_organization_fkey
  FOREIGN KEY (conversation_id, channel_account_id, organization_id)
  REFERENCES conversations (id, channel_account_id, organization_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX channel_accounts_organization_phone_number_unique
  ON channel_accounts (organization_id, phone_number);
CREATE UNIQUE INDEX channel_accounts_organization_provider_external_unique
  ON channel_accounts (organization_id, provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;
CREATE UNIQUE INDEX contacts_organization_phone_number_unique
  ON contacts (organization_id, phone_number)
  WHERE phone_number IS NOT NULL;
ALTER TABLE contact_identities
  ADD CONSTRAINT contact_identities_organization_account_external_id_key
  UNIQUE (organization_id, channel_account_id, external_id);
ALTER TABLE conversations
  ADD CONSTRAINT conversations_organization_account_external_id_key
  UNIQUE (organization_id, channel_account_id, external_id);
ALTER TABLE messages
  ADD CONSTRAINT messages_organization_account_provider_message_id_key
  UNIQUE (organization_id, channel_account_id, provider_message_id);

CREATE INDEX conversations_organization_inbox_index
  ON conversations (organization_id, status, last_message_at DESC NULLS LAST);

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
