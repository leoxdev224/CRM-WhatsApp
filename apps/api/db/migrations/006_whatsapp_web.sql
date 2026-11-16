ALTER TABLE channel_accounts ALTER COLUMN phone_number DROP NOT NULL;
ALTER TABLE channel_accounts ADD COLUMN connection_type TEXT NOT NULL DEFAULT 'demo' CHECK (connection_type IN ('demo', 'whatsapp_web'));
CREATE TABLE whatsapp_auth_state (
  channel_account_id UUID NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
  key_type TEXT NOT NULL,
  key_id TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  PRIMARY KEY (channel_account_id, key_type, key_id)
);
