-- Proxy de salida opcional por canal de WhatsApp Web.
-- La URL completa (con usuario y contraseña) se guarda cifrada con WHATSAPP_SESSION_KEY.
-- proxy_label guarda solo protocolo://host:puerto para mostrarlo en el panel.
ALTER TABLE channel_accounts
  ADD COLUMN proxy_encrypted TEXT,
  ADD COLUMN proxy_label TEXT CHECK (proxy_label IS NULL OR length(proxy_label) <= 300),
  ADD COLUMN proxy_exit_ip TEXT CHECK (proxy_exit_ip IS NULL OR length(proxy_exit_ip) <= 45),
  ADD COLUMN proxy_checked_at TIMESTAMPTZ,
  ADD CONSTRAINT channel_accounts_proxy_pair CHECK ((proxy_encrypted IS NULL) = (proxy_label IS NULL));
