CREATE TABLE conversation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  author_id UUID NOT NULL,
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, organization_id) REFERENCES conversations(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (author_id, organization_id) REFERENCES users(id, organization_id) ON DELETE RESTRICT
);
CREATE TABLE conversation_activity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('status', 'assigned_user_id')),
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, organization_id) REFERENCES conversations(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id, organization_id) REFERENCES users(id, organization_id) ON DELETE RESTRICT
);
