ALTER TABLE users ADD COLUMN mfa_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN mfa_last_counter BIGINT;
ALTER TABLE auth_sessions ADD COLUMN mfa_verified BOOLEAN NOT NULL DEFAULT false;
DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'admin');
