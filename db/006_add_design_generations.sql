-- Adds the design_generations table (OpenArt AI image/video generation
-- history — see src/routes/design.js) to an already-migrated database,
-- without touching anything existing. See schema.sql for the full comments.
CREATE TABLE IF NOT EXISTS design_generations (
  id                    SERIAL PRIMARY KEY,
  kind                  TEXT NOT NULL,
  prompt                TEXT NOT NULL,
  model                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  result_url            TEXT,
  openart_creation_id   TEXT,
  error                 TEXT,
  requested_by_user_id  INT REFERENCES users(id),
  requested_by_name     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_design_generations_created_at ON design_generations(created_at);
