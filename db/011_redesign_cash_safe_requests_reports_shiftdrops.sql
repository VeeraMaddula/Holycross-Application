-- Task #208: cash safe / requests / reports / shift-drops -> SQL.
--
-- cash_logs, cash_lodgement_history, reports, and shift_drops were created
-- early by apply-schema.js but their model files (cashSafe.js,
-- staffReports.js, shiftDrops.js) have only ever used readDb()/writeDb() —
-- never `query()` — so none of these three tables has ever had a row
-- written to it. Confirmed safe to DROP + recreate with the shape their
-- model files actually need, same reasoning as db/010's bookings redesign.
--
-- requests is the one exception: its existing columns are still useful and
-- keeping them avoids reshaping a table that's closer to correct — it was
-- just missing the recipient columns requests.js has always needed (every
-- request/report here is addressed to one specific person, not broadcast).
-- ALTER-ing it in place instead of dropping it.

DROP TABLE IF EXISTS cash_logs;
CREATE TABLE cash_logs (
  id                SERIAL PRIMARY KEY,
  date              DATE NOT NULL,
  logged_by_user_id INT REFERENCES users(id),
  logged_by_name    TEXT DEFAULT '',
  reason            TEXT DEFAULT '',
  coins_in          NUMERIC(10,2) NOT NULL DEFAULT 0,
  coins_out         NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes_in          NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes_out         NUMERIC(10,2) NOT NULL DEFAULT 0,
  total             NUMERIC(10,2) NOT NULL,
  photo_path        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cash_logs_created_at ON cash_logs(created_at);

DROP TABLE IF EXISTS cash_lodgement_history;
CREATE TABLE cash_lodgement_history (
  id                 SERIAL PRIMARY KEY,
  previous           NUMERIC(10,2) NOT NULL,
  new_amount         NUMERIC(10,2) NOT NULL,
  reason             TEXT DEFAULT '',
  changed_by_user_id INT REFERENCES users(id),
  changed_by_name    TEXT DEFAULT '',
  changed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS recipient_user_id INT REFERENCES users(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS recipient_name TEXT DEFAULT '';
ALTER TABLE requests ALTER COLUMN status SET DEFAULT 'sent';

DROP TABLE IF EXISTS reports;
CREATE TABLE reports (
  id                  SERIAL PRIMARY KEY,
  category            TEXT NOT NULL,
  category_label      TEXT DEFAULT '',
  details             TEXT DEFAULT '',
  files               JSONB NOT NULL DEFAULT '[]', -- [{path, originalName, mimeType, size}, ...]
  reported_by_user_id INT REFERENCES users(id),
  reported_by_name    TEXT DEFAULT '',
  recipient_user_id   INT REFERENCES users(id),
  recipient_name      TEXT DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'sent',
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_created_at ON reports(created_at);

DROP TABLE IF EXISTS shift_drops;
CREATE TABLE shift_drops (
  id                       SERIAL PRIMARY KEY,
  roster_shift_id          INT REFERENCES roster_shifts(id),
  shift                    JSONB, -- snapshot: {id, date, startTime, endTime}
  dropped_by_user_id       INT REFERENCES users(id),
  dropped_by_name          TEXT DEFAULT '',
  status                   TEXT NOT NULL DEFAULT 'open',
  claimed_by_user_id       INT REFERENCES users(id),
  claimed_by_name          TEXT,
  exchange_roster_shift_id INT REFERENCES roster_shifts(id),
  exchange_shift           JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at              TIMESTAMPTZ
);
CREATE INDEX idx_shift_drops_status ON shift_drops(status);
