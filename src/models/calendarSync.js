// Google Calendar sync bookkeeping — which booking maps to which Google
// event, the pulled-in external events shown alongside bookings on the
// Calendar page, and when the last sync ran. The actual Google API calls
// live in src/googleCalendar.js; this is just the local data side of it.
//
// SQL-backed as of task #206 for the external-events snapshot and the
// booking->Google-event-id link. setBookingGoogleEventId writes directly to
// bookings.google_event_id now that bookings.js is SQL-backed too — kept
// as its own tiny setter here (rather than routing through bookings.js)
// so a Google Calendar sync round-trip never touches a booking's audit
// history. external_calendar_events already matched the shape this needed
// (id, google_event_id, raw JSONB, synced_at) with no migration required.
//
// lastGoogleSyncAt stays in JSON (data/db.json's db.meta) for now — it was
// never part of the `settings` table (a singleton JSONB row, unrelated
// shape) and settings/meta haven't been converted yet (task #209), so this
// is a deliberate mixed SQL-events/JSON-timestamp read, same transitional
// pattern used elsewhere in this migration.
const { readDb, writeDb } = require('../db');
const { query } = require('../sqlPool');

async function setBookingGoogleEventId(id, googleEventId) {
  await query(`UPDATE bookings SET google_event_id = $1 WHERE id = $2`, [googleEventId || '', Number(id)]);
}

// Returns each external event in the exact shape googleCalendar.js's
// listExternalEvents() produced it in ({id, title, start, end,
// description} — `id` here is Google's own event id, stored inside `raw`,
// not this table's own SERIAL row id) — calendar.js's route reads these
// fields directly.
async function listExternalCalendarEvents() {
  const { rows } = await query(`SELECT raw FROM external_calendar_events ORDER BY synced_at DESC`);
  return rows.map(r => r.raw);
}

// Full replace, not additive — same as the JSON model: every sync call
// wipes the previous snapshot and inserts the fresh one from Google.
async function replaceExternalCalendarEvents(events) {
  await query(`DELETE FROM external_calendar_events`);
  for (const ev of events) {
    await query(
      `INSERT INTO external_calendar_events (google_event_id, raw) VALUES ($1, $2)`,
      [ev.id || '', JSON.stringify(ev)]
    );
  }
  const db = readDb();
  db.meta.lastGoogleSyncAt = new Date().toISOString();
  writeDb(db);
}

async function getGoogleSyncStatus() {
  const db = readDb();
  const { rows } = await query(`SELECT count(*)::int AS n FROM external_calendar_events`);
  return {
    lastSyncAt: db.meta.lastGoogleSyncAt || null,
    externalEventCount: rows[0].n
  };
}

module.exports = { setBookingGoogleEventId, listExternalCalendarEvents, replaceExternalCalendarEvents, getGoogleSyncStatus };
