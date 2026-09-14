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
  can_manage_vouchers       BOOLEAN NOT NULL DEFAULT false,
  can_view_breakage         BOOLEAN NOT NULL DEFAULT false,
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

-- Redesigned in db/010_redesign_bookings.sql (task #206) to add the fields
-- the JSON model always carried (duration/occasion/payment/deposit/
-- reminder/createdBy/history) and to correct `music` from TEXT to JSONB
-- (it's a structured object — provider, times, genres, artist, price —
-- same shape category as `food`, not plain text).
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
  music              JSONB,          -- structured object: provider/times/genres/artist/price
  food               JSONB,          -- courses + price, variable shape
  notes              TEXT DEFAULT '',
  occasion           TEXT DEFAULT '',
  payment_status     TEXT NOT NULL DEFAULT 'unpaid',
  deposit_amount     NUMERIC NOT NULL DEFAULT 0,
  reminder_sent      BOOLEAN NOT NULL DEFAULT false,
  google_event_id    TEXT DEFAULT '',
  created_by_user_id INT REFERENCES users(id),
  created_by_name    TEXT DEFAULT '',
  history            JSONB NOT NULL DEFAULT '[]',   -- [{at, event}, ...] audit trail
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- Event-log shape (redesigned in db/009_redesign_time_entries.sql, task
-- #207): one row per clock action — clock_in, clock_out, break_start,
-- break_end — matching what the kiosk actually records
-- (src/models/clockEntries.js). Shift/break durations are computed in
-- application code by pairing consecutive rows per user, not stored here.
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

-- area/notified/pending_action added in db/008_add_roster_shift_fields.sql
-- (task #207) to match the JSON model: which work area (Floor/Bar/Booth)
-- the shift is for, and the deferred manager-triggered notification state.
CREATE TABLE roster_shifts (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id),
  date       DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  color      TEXT,
  google_event_id TEXT,
  area       TEXT,
  notified   BOOLEAN NOT NULL DEFAULT false,
  pending_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_roster_shifts_date ON roster_shifts(date);
CREATE INDEX idx_roster_shifts_user ON roster_shifts(user_id);

-- recipient_user_id/recipient_name added in db/011 (task #208) — every
-- request has always been addressed to one specific person
-- (src/models/requests.js), the original table just never had a column
-- for it.
CREATE TABLE requests (
  id             SERIAL PRIMARY KEY,
  type           TEXT NOT NULL,
  type_label     TEXT,
  requested_by   INT NOT NULL REFERENCES users(id),
  requested_by_name TEXT,
  recipient_user_id INT REFERENCES users(id),
  recipient_name TEXT DEFAULT '',
  details        TEXT,
  status         TEXT NOT NULL DEFAULT 'sent',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Redesigned in db/012 (task #209) — the original columns had no `key` to
-- join on (dutyWindows.js's fixed schedule and every completion/report has
-- always keyed off 'opening'/'after_breakfast'/'after_carvery'/'closing',
-- not a SERIAL id), and duty_completions/duty_reports were missing most of
-- the fields dutyChecklist.js has always recorded (who/when per task tick;
-- reason/missing-tasks/staff-on-shift/trigger/submitted-by/photo per report).
CREATE TABLE duty_sections (
  id    SERIAL PRIMARY KEY,
  key   TEXT UNIQUE NOT NULL,  -- 'opening' | 'after_breakfast' | 'after_carvery' | 'closing'
  title TEXT NOT NULL,
  tasks JSONB NOT NULL DEFAULT '[]' -- [{id, text}, ...] — editable task list
);

-- One row per (date, task) tick — toggling a task back off deletes its row,
-- so this only ever holds currently-ticked tasks.
CREATE TABLE duty_completions (
  id                    SERIAL PRIMARY KEY,
  date                  DATE NOT NULL,
  task_id               TEXT NOT NULL, -- e.g. 'opening-3' or 'opening-custom-1'
  completed_by_user_id  INT REFERENCES users(id),
  completed_by_name     TEXT DEFAULT '',
  completed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, task_id)
);

-- One row per (date, section) at most — the first submit/auto-sweep for the
-- day wins; a later one can only fill in gaps (reason/submitted-by/photo)
-- it left. See dutyChecklist.js's recordDutyReport.
CREATE TABLE duty_reports (
  id                   SERIAL PRIMARY KEY,
  date                 DATE NOT NULL,
  section              TEXT NOT NULL, -- duty_sections.key, kept denormalized (not a FK id)
  section_title        TEXT DEFAULT '',
  complete             BOOLEAN NOT NULL DEFAULT false,
  reason               TEXT DEFAULT '',
  missing_task_texts   JSONB NOT NULL DEFAULT '[]',
  staff_on_shift_names JSONB NOT NULL DEFAULT '[]',
  trigger              TEXT DEFAULT 'auto',
  submitted_by_user_id INT REFERENCES users(id),
  submitted_by_name    TEXT DEFAULT '',
  photo_path           TEXT DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ,
  UNIQUE (date, section)
);
CREATE INDEX idx_duty_reports_created_at ON duty_reports(created_at);

-- Redesigned in db/011 (task #208) to add the dropped/claimed-by display
-- names and the shift/exchange-shift JSONB snapshots shiftDrops.js has
-- always kept (so a drop still displays correctly even if the underlying
-- roster shift is later changed or removed) — the original columns didn't
-- have anywhere to put those.
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

-- Redesigned in db/011 (task #208) — the original columns (submitted_by,
-- file_path, notes) never matched what staffReports.js actually needed:
-- one-to-one (a specific recipient, not just a category), a variable-length
-- files array (not one path), and a review workflow (status/reviewed_at).
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

-- Redesigned in db/012 (task #209) — the original columns used `title`/
-- `kitchen_category`/`media_path`/`visible_sections`, none of which match
-- what trainingResources.js actually reads/writes (name, subtitle,
-- ingredients, method, servingNotes, photoPath, videoPath, youtubeUrl,
-- youtubeId, createdByUserId).
CREATE TABLE training_items (
  id                 SERIAL PRIMARY KEY,
  category           TEXT NOT NULL,
  name               TEXT NOT NULL,
  subtitle           TEXT DEFAULT '',
  ingredients        TEXT DEFAULT '',
  method             TEXT DEFAULT '',
  serving_notes      TEXT DEFAULT '',
  photo_path         TEXT DEFAULT '',
  video_path         TEXT DEFAULT '',
  youtube_url        TEXT DEFAULT '',
  youtube_id         TEXT DEFAULT '',
  created_by_user_id INT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_training_items_category ON training_items(category);

-- Redesigned in db/011 (task #208) — the original columns were a single
-- generic amount/notes pair; cashSafe.js has always tracked coins/notes
-- in and out separately plus the shift's reconciled running total.
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

-- Redesigned in db/011 (task #208) to match what cashSafe.js's
-- setCashSafeLodgementTarget has always recorded: the previous target,
-- the new one, and why it changed.
CREATE TABLE cash_lodgement_history (
  id                 SERIAL PRIMARY KEY,
  previous           NUMERIC(10,2) NOT NULL,
  new_amount         NUMERIC(10,2) NOT NULL,
  reason             TEXT DEFAULT '',
  changed_by_user_id INT REFERENCES users(id),
  changed_by_name    TEXT DEFAULT '',
  changed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- Actual photo bytes (kiosk clock-in/break/duty selfies, profile/admin
-- avatars, Cash Safe photos, Training recipe photos, Report image
-- attachments) — see src/fileStore.js. Deliberately images only: CockroachDB
-- recommends keeping BYTES values under ~1MB for performance (see
-- https://www.cockroachlabs.com/docs/stable/bytes), so anything larger
-- (Training's how-to videos, Reports' video/audio/PDF/Word attachments)
-- stays on the persistent disk (PERSIST_DIR — see src/persist.js) instead of
-- going through this table.
CREATE TABLE files (
  id                  SERIAL PRIMARY KEY,
  category            TEXT NOT NULL, -- 'avatar' | 'clock_selfie' | 'duty_photo' | 'cash_safe_photo' | 'training_photo' | 'report_photo'
  filename            TEXT NOT NULL, -- display/original filename, not a disk path
  mime_type           TEXT NOT NULL,
  size_bytes          INT NOT NULL,
  data                BYTES NOT NULL,
  uploaded_by_user_id INT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- In-house physical gift vouchers. Staff record the voucher number printed
-- on the physical card at time of sale, then look it up by that same
-- number to log a redemption (partial redemptions supported — a voucher
-- can be spent down across more than one visit). remaining_balance is kept
-- as a column rather than always summed from voucher_redemptions so a
-- lookup-by-number at the till doesn't need a join.
CREATE TABLE vouchers (
  id                 SERIAL PRIMARY KEY,
  voucher_number     TEXT UNIQUE NOT NULL,
  face_value         NUMERIC(10,2) NOT NULL,
  remaining_balance  NUMERIC(10,2) NOT NULL,
  customer_name      TEXT,
  sold_by_user_id    INT REFERENCES users(id),
  sold_by_name       TEXT,
  sold_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL DEFAULT 'active' -- 'active' | 'partially_redeemed' | 'redeemed' | 'void'
);

CREATE TABLE voucher_redemptions (
  id                  SERIAL PRIMARY KEY,
  voucher_id          INT NOT NULL REFERENCES vouchers(id),
  amount              NUMERIC(10,2) NOT NULL,
  redeemed_by_user_id INT REFERENCES users(id),
  redeemed_by_name    TEXT,
  redeemed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  note                TEXT
);

-- Breakage/shortage self-reporting, captured as part of the kiosk clock-out
-- flow — one row per item a staff member flags on their way out, so
-- management can see patterns by person over time (src/routes/breakage.js).
CREATE TABLE breakage_reports (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id),
  user_name   TEXT NOT NULL,
  category    TEXT NOT NULL, -- 'glass' | 'spirit' | 'soft_drink'
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stock Delivery & Recheck (db/013_add_stock_deliveries.sql) — a second tab
-- on the same Breakage & Stock page. Every vendor delivery logged here with
-- an invoice photo, one or more physical-stock photos, and a tick
-- confirming the delivery matches the invoice; see src/models/stockDeliveries.js
-- for the fixed category list.
CREATE TABLE stock_deliveries (
  id                   SERIAL PRIMARY KEY,
  category             TEXT NOT NULL,
  subcategory          TEXT DEFAULT '',
  item_name            TEXT NOT NULL,
  vendor_name          TEXT DEFAULT '',
  delivery_date        DATE NOT NULL,
  quantity             TEXT DEFAULT '',
  matches_invoice      BOOLEAN NOT NULL DEFAULT false,
  notes                TEXT DEFAULT '',
  submitted_by_user_id INT REFERENCES users(id),
  submitted_by_name    TEXT NOT NULL,
  invoice_photo_path   TEXT NOT NULL, -- '/breakage/photo/<files.id>', not '/files/<id>' (internal, not public)
  stock_photo_paths    JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI image/video generations via the OpenArt CLI (see src/openArt.js) — the
-- Design Studio page (src/routes/design.js). Only metadata + the OpenArt CDN
-- result URL are stored here, never the media bytes: images/videos stay
-- hosted on OpenArt's own CDN (already durable, and videos in particular are
-- far too large for CockroachDB's BYTES column — see the files table's
-- comment above). openart_creation_id lets a still-running generation be
-- polled/resumed later via `openart creation get <id>`.
CREATE TABLE design_generations (
  id                    SERIAL PRIMARY KEY,
  kind                  TEXT NOT NULL, -- 'image' | 'video'
  prompt                TEXT NOT NULL,
  model                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'failed'
  result_url            TEXT,
  openart_creation_id   TEXT,
  used_reference        BOOLEAN NOT NULL DEFAULT false, -- a reference image/photo was uploaded and passed via --image
  error                 TEXT,
  requested_by_user_id  INT REFERENCES users(id),
  requested_by_name     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_design_generations_created_at ON design_generations(created_at);
