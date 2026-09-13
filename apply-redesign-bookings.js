// One-off — redesigns bookings into the full schema the app needs
// (db/010_redesign_bookings.sql). Safe because the live table has never
// been written to (bookings.js is still JSON-backed) — see the SQL file's
// own comment; confirmed 0 rows before running this.
// Usage: node apply-redesign-bookings.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getClient, getPool } = require('./src/sqlPool');

async function main() {
  const client = await getClient();
  try {
    // Defensive — see fix-serial-ids.js for why this matters: without it,
    // this table's new SERIAL id column would default to CockroachDB's
    // unique_rowid() (~19-digit ids) instead of small sequential ones.
    await client.query(`SET serial_normalization = 'sql_sequence'`);
    const sql = fs.readFileSync(path.join(__dirname, 'db', '010_redesign_bookings.sql'), 'utf-8');
    await client.query(sql);
    console.log('bookings table redesigned (duration/occasion/payment/deposit/reminder/createdBy/history columns added; music corrected to JSONB).');
  } finally {
    client.release();
  }
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
