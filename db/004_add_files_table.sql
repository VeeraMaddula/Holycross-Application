-- Adds the files table to an already-migrated database (i.e. one that
-- already has users/etc. and real data in it — this does NOT drop
-- anything, unlike fix-serial-ids.js). See schema.sql for the full comment
-- on why this table exists and why it's images-only.
CREATE TABLE IF NOT EXISTS files (
  id                  SERIAL PRIMARY KEY,
  category            TEXT NOT NULL,
  filename            TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          INT NOT NULL,
  data                BYTES NOT NULL,
  uploaded_by_user_id INT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
