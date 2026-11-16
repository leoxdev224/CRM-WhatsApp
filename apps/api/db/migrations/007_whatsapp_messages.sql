ALTER TABLE conversations ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'individual' CHECK (kind IN ('individual', 'group'));
ALTER TABLE conversations ADD CONSTRAINT conversations_contact_kind_check
  CHECK ((kind = 'individual' AND contact_id IS NOT NULL) OR (kind = 'group' AND contact_id IS NULL));

ALTER TABLE messages ADD COLUMN sender_external_id TEXT;
ALTER TABLE messages ADD COLUMN delivery_status INTEGER CHECK (delivery_status BETWEEN 1 AND 5);

CREATE TABLE whatsapp_message_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL,
  channel_account_id UUID NOT NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('message', 'status')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error_code TEXT,
  FOREIGN KEY (channel_account_id, organization_id) REFERENCES channel_accounts (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (channel_account_id, event_key)
);
CREATE INDEX whatsapp_message_events_pending_idx ON whatsapp_message_events (next_attempt_at, id) WHERE status IN ('pending', 'failed');

CREATE TABLE whatsapp_pending_statuses (
  organization_id UUID NOT NULL,
  channel_account_id UUID NOT NULL,
  provider_message_id TEXT NOT NULL,
  status INTEGER NOT NULL CHECK (status BETWEEN 1 AND 5),
  FOREIGN KEY (channel_account_id, organization_id) REFERENCES channel_accounts (id, organization_id) ON DELETE RESTRICT,
  PRIMARY KEY (channel_account_id, provider_message_id)
);
