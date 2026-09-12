-- Adds the used_reference column (Design Studio reference-image uploads —
-- see src/routes/design.js) to an already-migrated database.
ALTER TABLE design_generations ADD COLUMN IF NOT EXISTS used_reference BOOLEAN NOT NULL DEFAULT false;
