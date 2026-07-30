// Google Calendar sync bookkeeping — which booking maps to which Google
// event, the pulled-in external events shown alongside bookings on the
// Calendar page, and when the last sync ran. The actual Google API calls
// live in src/googleCalendar.js; this is just the local data side of it.
const { readDb, writeDb } = require('../db');

function setBookingGoogleEventId(id, googleEventId) {
  const db = readDb();
  const b = db.bookings.find(x => x.id === Number(id));
  if (!b) return;
  b.googleEventId = googleEventId || '';
  writeDb(db);
}

function listExternalCalendarEvents() {
  return readDb().externalCalendarEvents || [];
}

function replaceExternalCalendarEvents(events) {
  const db = readDb();
  db.externalCalendarEvents = events;
  db.meta.lastGoogleSyncAt = new Date().toISOString();
  writeDb(db);
}

function getGoogleSyncStatus() {
  const db = readDb();
  return {
    lastSyncAt: db.meta.lastGoogleSyncAt || null,
    externalEventCount: (db.externalCalendarEvents || []).length
  };
}

module.exports = { setBookingGoogleEventId, listExternalCalendarEvents, replaceExternalCalendarEvents, getGoogleSyncStatus };
