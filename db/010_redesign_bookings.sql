-- Redesigns bookings into the full shape the app actually needs — the
-- original schema was missing several fields the JSON model has always
-- carried (duration, occasion, payment status, deposit amount, the
-- reminder-sent flag, who created it, and the full audit history log
-- shown on each booking), and had `music` typed as plain TEXT even though
-- it's actually a structured object (provider, times, genres, artist,
-- price) — same shape category as `food`, which was already correctly
-- JSONB.
--
-- Confirmed safe to DROP + recreate rather than ALTER: this table was
-- created early by apply-schema.js but has never been written to —
-- bookings.js is still JSON-backed (data/db.json's bookings) as of task
-- #206. No production booking data lives in this table yet (verified: 0
-- rows via a direct count before running this).
DROP TABLE IF EXISTS bookings;

CREATE TABLE bookings (
  id                 SERIAL PRIMARY KEY,
  table_id           INT REFERENCES tables(id),
  customer_name      TEXT NOT NULL,
  phone              TEXT DEFAULT '',
  email              TEXT DEFAULT '',
  party_size         INT NOT NULL,
  date               DATE NOT NULL,
  time               TEXT NOT NULL,
  duration_minutes   INT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'confirmed',
  music              JSONB,
  food               JSONB,
  notes              TEXT DEFAULT '',
  occasion           TEXT DEFAULT '',
  payment_status     TEXT NOT NULL DEFAULT 'unpaid',
  deposit_amount     NUMERIC NOT NULL DEFAULT 0,
  reminder_sent      BOOLEAN NOT NULL DEFAULT false,
  google_event_id    TEXT DEFAULT '',
  created_by_user_id INT REFERENCES users(id),
  created_by_name    TEXT DEFAULT '',
  history            JSONB NOT NULL DEFAULT '[]',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_date ON bookings(date);
CREATE INDEX idx_bookings_status ON bookings(status);
