// One-time data migration — copies the existing JSON tables AND bookings
// (data/db.json, via src/db.js's readDb()) into the new SQL `tables` and
// `bookings` tables, now that models/tables.js and models/bookings.js are
// SQL-backed (task #206).
//
// This was missed when tables.js/bookings.js were first converted: the SQL
// schema was confirmed EMPTY right before that conversion, which was the
// correct expectation for `bookings` going forward, but the live JSON
// already held the real seating inventory (Main Floor tables + the two
// Function Rooms) AND some real historical bookings — neither ever got
// copied over. Without this, the SQL tables are empty and the "New
// Booking" form has no tables to pick from.
//
// IMPORTANT — where to run this: it only finds real data when data/db.json
// is the ACTUAL production file. On Render, data/ is symlinked onto the
// service's persistent disk (see src/persist.js) — that symlink only
// exists inside the running Render service itself. So this must be run
// from a Render Shell session for holycross-booking (Render sets
// DATABASE_URL there automatically), NOT from a local machine, which only
// has a local dev data/db.json.
// Usage (in the Render Shell): node migrate-tables-data.js
//
// Preserves every original numeric id exactly as it was in the JSON —
// bookings.table_id (and any other reference to a specific table) stays
// meaningful, and booking ids stay stable too. Tables are migrated first
// so bookings' table_id foreign key is always satisfied. Safe to re-run:
// every insert is ON CONFLICT (id) DO NOTHING, so running it again never
// duplicates a row. A booking whose createdByUserId no longer matches a
// real user is still inserted, with created_by_user_id set to NULL
// (created_by_name is kept as a human-readable record either way).
require('dotenv').config();
const { readDb } = require('./src/db');
const { query, getPool } = require('./src/sqlPool');

async function insertTable(t) {
  const { rowCount } = await query(
    `INSERT INTO tables (id, name, seats, area) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [t.id, t.name, t.seats, t.area]
  );
  return rowCount ? 'inserted' : 'already-present';
}

async function insertBooking(b) {
  let createdByUserId = b.createdByUserId || null;
  try {
    const { rowCount } = await query(
      `INSERT INTO bookings (
         id, table_id, customer_name, phone, email, party_size, date, time,
         duration_minutes, status, music, food, notes, occasion,
         payment_status, deposit_amount, reminder_sent, google_event_id,
         created_by_user_id, created_by_name, history, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22
       ) ON CONFLICT (id) DO NOTHING`,
      [
        b.id,
        b.tableId || null,
        b.customerName,
        b.phone || '',
        b.email || '',
        b.partySize,
        b.date,
        b.time,
        b.durationMinutes || 90,
        b.status || 'confirmed',
        JSON.stringify(b.music || null),
        JSON.stringify(b.food || null),
        b.notes || '',
        b.occasion || '',
        b.paymentStatus || 'unpaid',
        Number(b.depositAmount) || 0,
        !!b.reminderSent,
        b.googleEventId || '',
        createdByUserId,
        b.createdByName || '',
        JSON.stringify(b.history || []),
        b.createdAt || new Date().toISOString()
      ]
    );
    return rowCount ? 'inserted' : 'already-present';
  } catch (err) {
    if (err.code === '23503' && createdByUserId) {
      // Orphaned created-by user — retry once with created_by_user_id
      // NULLed out so the booking itself (a real historical record) isn't
      // lost over a stale reference.
      const { rowCount } = await query(
        `INSERT INTO bookings (
           id, table_id, customer_name, phone, email, party_size, date, time,
           duration_minutes, status, music, food, notes, occasion,
           payment_status, deposit_amount, reminder_sent, google_event_id,
           created_by_user_id, created_by_name, history, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17, $18, NULL, $19, $20, $21
         ) ON CONFLICT (id) DO NOTHING`,
        [
          b.id, b.tableId || null, b.customerName, b.phone || '', b.email || '',
          b.partySize, b.date, b.time, b.durationMinutes || 90, b.status || 'confirmed',
          JSON.stringify(b.music || null), JSON.stringify(b.food || null),
          b.notes || '', b.occasion || '', b.paymentStatus || 'unpaid',
          Number(b.depositAmount) || 0, !!b.reminderSent, b.googleEventId || '',
          b.createdByName || '', JSON.stringify(b.history || []),
          b.createdAt || new Date().toISOString()
        ]
      );
      return rowCount ? 'inserted (orphaned creator nulled)' : 'already-present';
    }
    throw err;
  }
}

async function main() {
  const db = readDb();
  const tables = db.tables || [];
  const bookings = db.bookings || [];

  console.log(`Found ${tables.length} table(s) and ${bookings.length} booking(s) in data/db.json.`);
  if (!tables.length && !bookings.length) {
    console.log('Nothing to migrate. If you expected real data here, double-check you are running this in the Render Shell for holycross-booking, not locally.');
    await getPool().end();
    return;
  }

  const tableTally = { inserted: 0, 'already-present': 0 };
  for (const t of tables) {
    const outcome = await insertTable(t);
    tableTally[outcome]++;
  }
  console.log(`Tables — inserted: ${tableTally.inserted}, already present: ${tableTally['already-present']}.`);

  const bookingTally = {};
  for (const b of bookings) {
    const outcome = await insertBooking(b);
    bookingTally[outcome] = (bookingTally[outcome] || 0) + 1;
  }
  console.log(`Bookings — ${Object.entries(bookingTally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none to insert'}.`);

  await query(`SELECT setval(pg_get_serial_sequence('tables', 'id'), COALESCE((SELECT MAX(id) FROM tables), 1))`);
  await query(`SELECT setval(pg_get_serial_sequence('bookings', 'id'), COALESCE((SELECT MAX(id) FROM bookings), 1))`);
  console.log('Sequences advanced past the migrated ids.');

  console.log('\nDone. Check the "New Booking" table picker, the Tables page, and the Bookings/Dashboard/Calendar pages now show the full seating list and any historical bookings correctly.');
  await getPool().end();
}

main().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
