-- Adds the vouchers, voucher_redemptions, and breakage_reports tables, plus
-- their per-user access-toggle columns, to an already-migrated database,
-- without touching anything existing. See schema.sql for the full comments
-- on each.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_vouchers BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_breakage BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS vouchers (
  id                 SERIAL PRIMARY KEY,
  voucher_number     TEXT UNIQUE NOT NULL,
  face_value         NUMERIC(10,2) NOT NULL,
  remaining_balance  NUMERIC(10,2) NOT NULL,
  customer_name      TEXT,
  sold_by_user_id    INT REFERENCES users(id),
  sold_by_name       TEXT,
  sold_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id                  SERIAL PRIMARY KEY,
  voucher_id          INT NOT NULL REFERENCES vouchers(id),
  amount              NUMERIC(10,2) NOT NULL,
  redeemed_by_user_id INT REFERENCES users(id),
  redeemed_by_name    TEXT,
  redeemed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  note                TEXT
);

CREATE TABLE IF NOT EXISTS breakage_reports (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id),
  user_name   TEXT NOT NULL,
  category    TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
