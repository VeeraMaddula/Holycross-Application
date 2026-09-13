-- Task #209 (part 1): duties + training -> SQL.
--
-- duty_sections/duty_completions/duty_reports/training_items were created
-- early by apply-schema.js but their model files (dutyTasks.js,
-- dutyChecklist.js, trainingResources.js) have only ever used
-- readDb()/writeDb() — never `query()` — and their shapes never actually
-- matched what those files need (duty_sections had no `key` column to join
-- on; duty_completions/duty_reports were missing most of the fields
-- dutyChecklist.js has always recorded; training_items used `title` instead
-- of `name` and was missing subtitle/ingredients/method/servingNotes/
-- photoPath/videoPath/youtubeUrl/youtubeId/createdByUserId entirely).
-- Confirmed safe to DROP + recreate, same reasoning as db/010 and db/011.
--
-- notifications/settings/menu/events are NOT touched here — their existing
-- shapes already match what notificationsLog.js/settings.js/menu.js need,
-- so only the model files themselves need rewriting, not the schema.

DROP TABLE IF EXISTS duty_completions;
DROP TABLE IF EXISTS duty_reports;
DROP TABLE IF EXISTS duty_sections;

-- `key` ('opening' | 'after_breakfast' | 'after_carvery' | 'closing') is
-- the stable identifier dutyWindows.js's fixed schedule and every
-- completion/report record actually key off — not the SERIAL id.
CREATE TABLE duty_sections (
  id    SERIAL PRIMARY KEY,
  key   TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  tasks JSONB NOT NULL DEFAULT '[]' -- [{id, text}, ...] — editable task list
);

-- One row per (date, task) tick — a task can be toggled off again
-- (deleted), so this only ever holds currently-ticked tasks, same as the
-- JSON model.
CREATE TABLE duty_completions (
  id                    SERIAL PRIMARY KEY,
  date                  DATE NOT NULL,
  task_id               TEXT NOT NULL, -- e.g. 'opening-3' or 'opening-custom-1'
  completed_by_user_id  INT REFERENCES users(id),
  completed_by_name     TEXT DEFAULT '',
  completed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, task_id)
);

-- One row per (date, section) at most — see dutyChecklist.js's
-- recordDutyReport for why: first submit/auto-sweep for the day wins, a
-- later one can only fill in gaps (reason/submitted-by/photo) it left.
CREATE TABLE duty_reports (
  id                   SERIAL PRIMARY KEY,
  date                 DATE NOT NULL,
  section              TEXT NOT NULL, -- duty_sections.key, not a FK id (kept denormalized, same as JSON)
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

DROP TABLE IF EXISTS training_items;
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
