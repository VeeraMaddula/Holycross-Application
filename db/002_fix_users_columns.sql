-- Follow-up migration — the first schema.sql apply missed several fields
-- that turned out to live directly on the user row (found while converting
-- src/models/users.js: kiosk PIN, password-reset tokens, and self-service
-- verification codes are all set directly on `db.users[i]` by other model
-- files, not stored anywhere separate). Safe to run once against the
-- cluster that already has the original schema.sql applied.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS live_shift_avatar_path TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS self_verify_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS self_verify_purpose TEXT,
  ADD COLUMN IF NOT EXISTS self_verify_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS privacy_policy_accepted_at TIMESTAMPTZ;

DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS verification_codes;
