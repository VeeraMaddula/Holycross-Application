// One-off — drops and recreates time_entries in the event-log shape
// (db/009_redesign_time_entries.sql). Safe because the live table has never
// been written to (clockEntries.js is still JSON-backed) — see the SQL
// file's own comment. Usage: node apply-redesign-time-entries.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, getPool } = require('./src/sqlPool');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'db', '009_redesign_time_entries.sql'), 'utf-8');
  await query(sql);
  console.log('time_entries redesigned into the event-log shape (clock_in/clock_out/break_start/break_end rows).');
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
