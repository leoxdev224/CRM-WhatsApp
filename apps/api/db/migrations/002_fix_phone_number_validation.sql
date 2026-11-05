ALTER TABLE channel_accounts DROP CONSTRAINT channel_accounts_phone_number_check;
ALTER TABLE channel_accounts
  ADD CONSTRAINT channel_accounts_phone_number_check
  CHECK (phone_number ~ '^\+[1-9][0-9]{6,14}$');

ALTER TABLE contacts DROP CONSTRAINT contacts_phone_number_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_phone_number_check
  CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{6,14}$');
