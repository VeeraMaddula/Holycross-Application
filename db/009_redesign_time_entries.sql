-- Redesigns time_entries from a one-row-per-completed-shift table
-- (clock_in_at/clock_out_at/break_minutes) into the event-log shape the
-- kiosk actually uses (src/models/clockEntries.js): one row per clock
-- action (clock_in, clock_out, break_start, break_end), with shift/break
-- durations computed in application code by pairing consecutive rows.
--
-- Confirmed safe to DROP + recreate rather than ALTER: this table was
-- created early by apply-schema.js but has never been written to —
-- clockEntries.js is still JSON-backed (data/db.json's timeEntries) as of
-- task #207. No production time-entry data lives in this table yet.
DROP TABLE IF EXISTS time_entries;

CREATE TABLE time_entries (
  id             SERIAL PRIMARY KEY,
  user_id        INT8 NOT NULL REFERENCES users(id),
  user_name      TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
  at             TIMESTAMPTZ NOT NULL,
  selfie_path    TEXT DEFAULT '',
  manually_added BOOLEAN NOT NULL DEFAULT false,
  edited         BOOLEAN NOT NULL DEFAULT false,
  edited_by      TEXT DEFAULT '',
  edited_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_time_entries_user ON time_entries(user_id);
CREATE INDEX idx_time_entries_at ON time_entries(at);
