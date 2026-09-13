// One-off — adds the area/notified/pending_action columns
// (db/008_add_roster_shift_fields.sql) to the already-running database.
// Just ALTER TABLE ... ADD COLUMN IF NOT EXISTS, safe to re-run.
// Usage: node apply-roster-shift-fields.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, getPool } = require('./src/sqlPool');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'db', '008_add_roster_shift_fields.sql'), 'utf-8');
  await query(sql);
  console.log('roster_shifts.area / .notified / .pending_action columns added (or already existed).');
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
