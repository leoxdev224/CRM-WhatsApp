ALTER TABLE messages ADD COLUMN send_state TEXT CHECK (send_state IN ('sending', 'submitted', 'unknown'));
