-- Adds the work-area (Floor/Bar/Booth) and deferred-notification fields to
-- roster_shifts that the JSON model (src/models/roster.js) already carries
-- on every shift, so the SQL table can hold the same data once roster.js is
-- converted (task #207). Additive only — safe to run on the live table.
ALTER TABLE roster_shifts ADD COLUMN IF NOT EXISTS area TEXT;
ALTER TABLE roster_shifts ADD COLUMN IF NOT EXISTS notified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE roster_shifts ADD COLUMN IF NOT EXISTS pending_action TEXT;
