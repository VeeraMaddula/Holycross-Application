// Admin danger-zone actions (Settings page, admin only) — clearing
// operational data or wiping the whole database back to factory defaults.
const { writeDb, DEFAULT_DATA } = require('../db');
const { readDb } = require('../db');
const { createUser } = require('./users');

// Clears all operational/transactional data — bookings, notification logs,
// clock-in history, roster shifts, staff requests, and pulled-in external
// calendar events — but leaves user accounts, tables, the menu, and
// settings untouched. For wiping demo/test activity without losing staff
// logins or the restaurant's configuration.
function clearOperationalData() {
  const db = readDb();
  db.bookings = [];
  db.notifications = [];
  db.timeEntries = [];
  db.rosterShifts = [];
  db.requests = [];
  db.dutyCompletions = [];
  db.dutyReports = [];
  db.shiftDrops = [];
  db.reports = [];
  db.cashLogs = [];
  db.cashLodgementHistory = [];
  db.externalCalendarEvents = [];
  db.meta.nextBookingId = 1;
  db.meta.nextNotificationId = 1;
  db.meta.nextTimeEntryId = 1;
  db.meta.nextRosterShiftId = 1;
  db.meta.nextRequestId = 1;
  db.meta.nextShiftDropId = 1;
  db.meta.lastGoogleSyncAt = null;
  writeDb(db);
}

// Wipes EVERYTHING back to the app's defaults — tables, menu, bookings,
// notifications, every user account, all of it — then creates exactly one
// fresh admin account so there's always a way back in. Irreversible; the
// caller (routes/settings.js) is responsible for ending the current
// session afterwards since the account that was logged in no longer exists.
async function factoryReset(adminEmail, adminPasswordHash) {
  const fresh = JSON.parse(JSON.stringify(DEFAULT_DATA));
  writeDb(fresh);
  return await createUser({ name: 'Admin', email: adminEmail, passwordHash: adminPasswordHash, role: 'admin' });
}

module.exports = { clearOperationalData, factoryReset };
