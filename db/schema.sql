-- The Holy Cross booking app — CockroachDB schema
-- Mirrors the current data/db.json collections 1:1. Top-level entities get
-- real columns + foreign keys; deeply nested/variable sub-structures (booking
-- food/courses, menu item lists, duty task lists) stay as JSONB, same as they
-- are in the JSON file today, to keep the rewrite scope and risk contained.
-- CockroachDB is Postgres-wire-compatible, so this is standard Postgres DDL.

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT UNIQUE,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  phone         TEXT,
  dob           DATE,
  sex           TEXT,
  location      TEXT,
  role          TEXT NOT NULL,
  color         TEXT,
  pin           TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  avatar_path   TEXT,
  -- per-feature access toggles (kept as individual booleans to match
  -- existing model function names exactly)
  can_view_timesheets       BOOLEAN NOT NULL DEFAULT false,
  can_manage_roster         BOOLEAN NOT NULL DEFAULT false,
  can_make_requests         BOOLEAN NOT NULL DEFAULT false,
  can_book_functions        BOOLEAN NOT NULL DEFAULT false,
  can_view_notifications    BOOLEAN NOT NULL DEFAULT false,
  can_manage_cash_safe      BOOLEAN NOT NULL DEFAULT false,
  can_view_logs             BOOLEAN NOT NULL DEFAULT false,
  can_edit_duties           BOOLEAN NOT NULL DEFAULT false,
  can_edit_training         BOOLEAN NOT NULL DEFAULT false,
  -- Kiosk clock-in PIN (hashed, same as password_hash) and the avatar shown
  -- while actively clocked in (separate from the normal profile avatar).
  pin_hash             TEXT,
  live_shift_avatar_path TEXT,
  -- Forgot-password-by-email token (passwordReset.js) — one-time, 1hr TTL.
  reset_token_hash      TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  -- Self-service verification code (selfVerification.js) — used from the
  -- Profile page to confirm a password or PIN change while logged in.
  self_verify_code_hash TEXT,
  self_verify_purpose   TEXT,
  self_verify_expires_at TIMESTAMPTZ,
  privacy_policy_version TEXT,
  privacy_policy_accepted_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tables (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  seats  INT NOT NULL,
  area   TEXT NOT NULL
);

CREATE TABLE bookings (
  id             SERIAL PRIMARY KEY,
  table_id       INT REFERENCES tables(id),
  customer_name  TEXT NOT NULL,
  phone          TEXT,
  email          TEXT,
  party_size     INT NOT NULL,
  date           DATE NOT NULL,
  time           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'confirmed',
  music          TEXT,
  food           JSONB,          -- courses + price, variable shape
  notes          TEXT,
  google_event_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_date ON bookings(date);
CREATE INDEX idx_bookings_status ON bookings(status);

CREATE TABLE menu (
  id     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton row
  intro  TEXT,
  sections JSONB NOT NULL   -- [{title, items:[{name, price, desc}]}]
);

CREATE TABLE events (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  date        DATE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  booking_id  INT,
  recipient   TEXT,
  subject     TEXT,
  text        TEXT,
  status      TEXT NOT NULL,
  error       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_sent_at ON notifications(sent_at);

CREATE TABLE external_calendar_events (
  id         SERIAL PRIMARY KEY,
  google_event_id TEXT,
  raw        JSONB,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE time_entries (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id),
  clock_in_at TIMESTAMPTZ,
  clock_out_at TIMESTAMPTZ,
  break_minutes INT DEFAULT 0,
  clock_in_photo_path TEXT,
  break_photo_path TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_time_entries_user ON time_entries(user_id);

CREATE TABLE roster_shifts (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id),
  date       DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  color      TEXT,
  google_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_roster_shifts_date ON roster_shifts(date);
CREATE INDEX idx_roster_shifts_user ON roster_shifts(user_id);

CREATE TABLE requests (
  id             SERIAL PRIMARY KEY,
  type           TEXT NOT NULL,
  type_label     TEXT,
  requested_by   INT NOT NULL REFERENCES users(id),
  requested_by_name TEXT,
  details        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE duty_sections (
  id       SERIAL PRIMARY KEY,
  title    TEXT NOT NULL,
  tasks    JSONB NOT NULL DEFAULT '[]',   -- editable task list, variable shape
  window_start TEXT,
  window_end   TEXT
);

CREATE TABLE duty_completions (
  id           SERIAL PRIMARY KEY,
  section_id   INT REFERENCES duty_sections(id),
  task_key     TEXT,
  completed_by INT REFERENCES users(id),
  photo_path   TEXT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE duty_reports (
  id         SERIAL PRIMARY KEY,
  section_id INT REFERENCES duty_sections(id),
  status     TEXT NOT NULL,
  escalated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shift_drops (
  id            SERIAL PRIMARY KEY,
  shift_id      INT REFERENCES roster_shifts(id),
  dropped_by    INT REFERENCES users(id),
  picked_up_by  INT REFERENCES users(id),
  exchange_shift_id INT REFERENCES roster_shifts(id),
  status        TEXT NOT NULL DEFAULT 'open',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL,
  submitted_by INT REFERENCES users(id),
  file_path   TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE training_items (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  category     TEXT,
  kitchen_category TEXT,
  media_path   TEXT,
  visible_sections JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cash_logs (
  id          SERIAL PRIMARY KEY,
  logged_by   INT REFERENCES users(id),
  amount      NUMERIC(10,2),
  photo_path  TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cash_lodgement_history (
  id          SERIAL PRIMARY KEY,
  amount      NUMERIC(10,2),
  target      NUMERIC(10,2),
  set_by      INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Note: password-reset tokens and self-verification codes are NOT separate
-- tables — matching the current JSON model, they live as columns directly
-- on the users row (reset_token_hash/reset_token_expires_at,
-- self_verify_code_hash/self_verify_purpose/self_verify_expires_at above).
-- Each user only ever has one active token/code at a time, so a join table
-- would be pure overhead here.

-- Singleton settings row (slotDurationMinutes, reminderHoursBefore, openHour,
-- closeHour, cashSafeLodgementTarget) — kept as JSONB since it's a small,
-- rarely-queried config blob, not something that benefits from columns.
CREATE TABLE settings (
  id    INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data  JSONB NOT NULL
);

-- Note: "meta" (nextBookingId, nextTableId, etc. counters in db.json) goes
-- away entirely — every table above uses SERIAL primary keys, so the
-- database generates the next ID itself. No equivalent table needed.
