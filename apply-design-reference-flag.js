// One-off — adds the used_reference column
// (db/007_add_design_reference_flag.sql) to the already-running database.
// Just an ALTER TABLE with no new SERIAL columns involved, so no need for
// the dedicated-client serial_normalization dance the table-creation
// scripts use.
// Usage: node apply-design-reference-flag.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, getPool } = require('./src/sqlPool');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'db', '007_add_design_reference_flag.sql'), 'utf-8');
  await query(sql);
  console.log('design_generations.used_reference column added (or already existed).');
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
