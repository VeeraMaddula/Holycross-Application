// Admin danger-zone actions (Settings page, admin only) — clearing
// operational data or wiping the whole database back to factory defaults.
const { writeDb, DEFAULT_DATA } = require('../db');
const { readDb } = require('../db');
const { query } = require('../sqlPool');
const { createUser } = require('./users');

// Clears all operational/transactional data — bookings, notification logs,
// clock-in history, roster shifts, staff requests, and pulled-in external
// calendar events — but leaves user accounts, tables, the menu, and
// settings untouched. For wiping demo/test activity without losing staff
// logins or the restaurant's configuration.
//
// bookings/time_entries/roster_shifts/external_calendar_events moved to
// SQL in tasks #206/#207 — clearing them is now a DELETE against those
// tables (their SERIAL id sequences don't need resetting the way the old
// JSON meta counters did; a gap in ids after a clear is harmless). The
// remaining collections below (notifications, requests, duties, shift
// drops, reports, cash safe) are still JSON, pending tasks #208/#209.
async function clearOperationalData() {
  await Promise.all([
    query(`DELETE FROM bookings`),
    query(`DELETE FROM time_entries`),
    query(`DELETE FROM roster_shifts`),
    query(`DELETE FROM external_calendar_events`)
  ]);

  const db = readDb();
  db.notifications = [];
  db.requests = [];
  db.dutyCompletions = [];
  db.dutyReports = [];
  db.shiftDrops = [];
  db.reports = [];
  db.cashLogs = [];
  db.cashLodgementHistory = [];
  db.meta.nextNotificationId = 1;
  db.meta.nextRequestId = 1;
  db.meta.nextShiftDropId = 1;
  db.meta.lastGoogleSyncAt = null;
  writeDb(db);
}

// Wipes EVERYTHING back to the app's defaults — tables, menu, bookings,
// notifications, all of it — then creates exactly one fresh admin account
// so there's always a way back in. Irreversible; the caller
// (routes/settings.js) is responsible for ending the current session
// afterwards since the account that was logged in no longer exists.
//
// NOTE (pre-existing, not introduced by this change): this does not delete
// existing user accounts — it only adds one new admin — because users.js
// moved to SQL in an earlier task (#205) and this function was never
// updated to also clear the users table. Left as-is for now since
// deleting every account is a materially bigger, more sensitive change
// than the SQL-table clearing this pass is responsible for; worth a
// dedicated look before this button is called a true "factory reset"
// again.
async function factoryReset(adminEmail, adminPasswordHash) {
  const fresh = JSON.parse(JSON.stringify(DEFAULT_DATA));
  writeDb(fresh);

  await Promise.all([
    query(`DELETE FROM bookings`),
    query(`DELETE FROM time_entries`),
    query(`DELETE FROM roster_shifts`),
    query(`DELETE FROM external_calendar_events`),
    query(`DELETE FROM tables`)
  ]);
  for (const t of DEFAULT_DATA.tables) {
    await query(`INSERT INTO tables (id, name, seats, area) VALUES ($1, $2, $3, $4)`, [t.id, t.name, t.seats, t.area]);
  }
  await query(`SELECT setval(pg_get_serial_sequence('tables', 'id'), COALESCE((SELECT MAX(id) FROM tables), 1))`);

  return await createUser({ name: 'Admin', email: adminEmail, passwordHash: adminPasswordHash, role: 'admin' });
}

module.exports = { clearOperationalData, factoryReset };
