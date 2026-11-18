CREATE TABLE security_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID,
  actor_id UUID,
  action TEXT NOT NULL,
  target_id UUID,
  http_status INTEGER NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX security_audit_organization_time_idx ON security_audit (organization_id, id DESC);
