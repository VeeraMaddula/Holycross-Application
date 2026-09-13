// Admin danger-zone actions (Settings page, admin only) — clearing
// operational data or wiping the whole database back to factory defaults.
const { writeDb, readDb, DEFAULT_DATA } = require('../db');
const { query } = require('../sqlPool');
const { createUser } = require('./users');
const { seedKitchenStarterContent } = require('./trainingResources');

// Clears all operational/transactional data — bookings, notification logs,
// clock-in history, roster shifts, staff requests/reports, the shift
// marketplace, cash safe logs, and pulled-in external calendar events —
// but leaves user accounts, tables, the menu, settings, and the duties
// task list itself untouched. For wiping demo/test activity without
// losing staff logins or the restaurant's configuration.
//
// Everything deleted here moved to SQL across tasks #206-#209 — see each
// table's own schema file (db/010, db/011, db/012) for why its shape looks
// the way it does. shift_drops is deleted before roster_shifts (not
// alongside it in the same Promise.all) because it has a foreign key to
// roster_shifts(id) with no cascade — same FK-ordering reasoning as
// bookings/tables in factoryReset below.
async function clearOperationalData() {
  await query(`DELETE FROM bookings`);
  await query(`DELETE FROM shift_drops`);
  await Promise.all([
    query(`DELETE FROM time_entries`),
    query(`DELETE FROM roster_shifts`),
    query(`DELETE FROM external_calendar_events`),
    query(`DELETE FROM notifications`),
    query(`DELETE FROM requests`),
    query(`DELETE FROM reports`),
    query(`DELETE FROM cash_logs`),
    query(`DELETE FROM cash_lodgement_history`),
    query(`DELETE FROM duty_completions`),
    query(`DELETE FROM duty_reports`)
  ]);

  // lastGoogleSyncAt is the one remaining piece of operational state still
  // living in the JSON file (see calendarSync.js) — everything else above
  // is SQL now.
  const db = readDb();
  db.meta.lastGoogleSyncAt = null;
  writeDb(db);
}

// Wipes EVERYTHING back to the app's defaults — tables, menu, settings,
// bookings, notifications, duties, training content, all of it — then
// creates exactly one fresh admin account so there's always a way back in.
// Irreversible; the caller (routes/settings.js) is responsible for ending
// the current session afterwards since the account that was logged in no
// longer exists.
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

  // bookings.table_id and shift_drops.roster_shift_id/exchange_roster_shift_id
  // have foreign keys with no cascade, so DELETE FROM tables/roster_shifts
  // must never run concurrently with (or before) the deletes of whatever
  // references them — see clearOperationalData's comment above and the
  // factory-reset bug this exact pattern caused (task #253).
  await query(`DELETE FROM bookings`);
  await query(`DELETE FROM shift_drops`);
  await Promise.all([
    query(`DELETE FROM time_entries`),
    query(`DELETE FROM roster_shifts`),
    query(`DELETE FROM external_calendar_events`),
    query(`DELETE FROM tables`),
    query(`DELETE FROM notifications`),
    query(`DELETE FROM requests`),
    query(`DELETE FROM reports`),
    query(`DELETE FROM cash_logs`),
    query(`DELETE FROM cash_lodgement_history`),
    query(`DELETE FROM duty_completions`),
    query(`DELETE FROM duty_reports`),
    query(`DELETE FROM duty_sections`), // repopulated from the DEFAULT_DUTY_SECTIONS seed the next time anyone reads it (dutyTasks.js's ensureSeeded)
    query(`DELETE FROM training_items`),
    query(`DELETE FROM events`)
  ]);

  for (const t of DEFAULT_DATA.tables) {
    await query(`INSERT INTO tables (id, name, seats, area) VALUES ($1, $2, $3, $4)`, [t.id, t.name, t.seats, t.area]);
  }
  await query(`SELECT setval(pg_get_serial_sequence('tables', 'id'), COALESCE((SELECT MAX(id) FROM tables), 1))`);

  await query(
    `INSERT INTO settings (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [JSON.stringify(DEFAULT_DATA.settings)]
  );
  await query(
    `INSERT INTO menu (id, intro, sections) VALUES (1, $1, $2) ON CONFLICT (id) DO UPDATE SET intro = EXCLUDED.intro, sections = EXCLUDED.sections`,
    [DEFAULT_DATA.menu.intro, JSON.stringify(DEFAULT_DATA.menu.sections)]
  );
  // Gives the Training page real content again immediately, rather than
  // leaving it empty until the next server restart (seedKitchenStarterContent
  // is otherwise only ever called once, at boot — see server.js).
  await seedKitchenStarterContent();

  return await createUser({ name: 'Admin', email: adminEmail, passwordHash: adminPasswordHash, role: 'admin' });
}

module.exports = { clearOperationalData, factoryReset };
