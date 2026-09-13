// One-time data migration — copies the existing JSON rosterShifts/
// timeEntries (data/db.json, via src/db.js's readDb()) into the new SQL
// tables (roster_shifts / time_entries), now that models/roster.js and
// models/clockEntries.js are SQL-backed (task #207).
//
// IMPORTANT — where to run this: it only finds real data when data/db.json
// is the ACTUAL production file. On Render, data/ is symlinked onto the
// service's persistent disk (see src/persist.js) — that symlink only
// exists inside the running Render service itself. So this must be run
// from a Render Shell session for the holycross-booking service (Render
// sets DATABASE_URL there automatically), NOT from a local machine, which
// only has a local dev data/db.json with none of the real shifts/entries.
// Usage (in the Render Shell): node migrate-roster-timesheets-data.js
//
// Preserves every original numeric id exactly as it was in the JSON —
// critical because data/db.json's shiftDrops collection (still JSON, task
// #208) references roster shift ids directly via rosterShiftId, and isn't
// touched by this migration. After the explicit-id inserts, each table's
// own auto-increment sequence is advanced past the highest migrated id, so
// the next *new* shift/entry created through the app (which lets SERIAL
// generate its id) doesn't collide with one just inserted here.
//
// Safe to re-run: every insert is ON CONFLICT (id) DO NOTHING, so running
// this again (e.g. after a partial failure) never duplicates a row. A row
// whose userId no longer matches a real user (leftover from well before
// the users table itself moved to CockroachDB) is skipped and reported,
// not fatal to the rest of the migration.
require('dotenv').config();
const { readDb } = require('./src/db');
const { query, getPool } = require('./src/sqlPool');

async function insertShift(s) {
  try {
    const { rowCount } = await query(
      `INSERT INTO roster_shifts (id, user_id, date, start_time, end_time, area, notified, pending_action)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.userId, s.date, s.startTime, s.endTime, s.area || null, !!s.notified, s.pendingAction || null]
    );
    return rowCount ? 'inserted' : 'already-present';
  } catch (err) {
    if (err.code === '23503') return 'orphaned-user';
    throw err;
  }
}

async function insertEntry(e) {
  try {
    const { rowCount } = await query(
      `INSERT INTO time_entries (id, user_id, user_name, action, at, selfie_path, manually_added, edited, edited_by, edited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [e.id, e.userId, e.userName, e.action, e.at, e.selfiePath || '', !!e.manuallyAdded, !!e.edited, e.editedBy || '', e.editedAt || null]
    );
    return rowCount ? 'inserted' : 'already-present';
  } catch (err) {
    if (err.code === '23503') return 'orphaned-user';
    throw err;
  }
}

async function main() {
  const db = readDb();
  const shifts = db.rosterShifts || [];
  const entries = db.timeEntries || [];

  console.log(`Found ${shifts.length} roster shift(s) and ${entries.length} time entr${entries.length === 1 ? 'y' : 'ies'} in data/db.json.`);
  if (!shifts.length && !entries.length) {
    console.log('Nothing to migrate. If you expected real data here, double-check you are running this in the Render Shell for holycross-booking, not locally.');
    await getPool().end();
    return;
  }

  const shiftTally = { inserted: 0, 'already-present': 0, 'orphaned-user': 0 };
  for (const s of shifts) {
    const outcome = await insertShift(s);
    shiftTally[outcome]++;
    if (outcome === 'orphaned-user') console.warn(`  Skipped roster shift ${s.id} (user ${s.userId}, ${s.date}) — that user no longer exists.`);
  }
  console.log(`Roster shifts — inserted: ${shiftTally.inserted}, already present: ${shiftTally['already-present']}, skipped (orphaned user): ${shiftTally['orphaned-user']}.`);

  const entryTally = { inserted: 0, 'already-present': 0, 'orphaned-user': 0 };
  for (const e of entries) {
    const outcome = await insertEntry(e);
    entryTally[outcome]++;
    if (outcome === 'orphaned-user') console.warn(`  Skipped time entry ${e.id} (user ${e.userId}, ${e.action} at ${e.at}) — that user no longer exists.`);
  }
  console.log(`Time entries — inserted: ${entryTally.inserted}, already present: ${entryTally['already-present']}, skipped (orphaned user): ${entryTally['orphaned-user']}.`);

  // Advance each table's own id sequence past the highest migrated id, so
  // the next shift/entry created through the app doesn't collide with one
  // of the ids just inserted.
  await query(`SELECT setval(pg_get_serial_sequence('roster_shifts', 'id'), COALESCE((SELECT MAX(id) FROM roster_shifts), 1))`);
  await query(`SELECT setval(pg_get_serial_sequence('time_entries', 'id'), COALESCE((SELECT MAX(id) FROM time_entries), 1))`);
  console.log('Sequences advanced past the migrated ids.');

  console.log('\nDone. Next: check the Roster and Timesheets pages show this data correctly. The JSON rosterShifts/timeEntries arrays in data/db.json are no longer read by the app — safe to leave as an inert backup, no need to delete them.');
  await getPool().end();
}

main().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
