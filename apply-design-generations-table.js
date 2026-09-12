// One-off — adds the new design_generations table
// (db/006_add_design_generations.sql) to the already-running database,
// without touching any existing table/data.
// Usage: node apply-design-generations-table.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getClient, getPool } = require('./src/sqlPool');

async function main() {
  const client = await getClient();
  try {
    // Defensive — see fix-serial-ids.js for why this matters: without it,
    // this table's SERIAL id column would default to CockroachDB's
    // unique_rowid() (~19-digit ids, past JS's safe integer range) instead
    // of small sequential ones.
    await client.query(`SET serial_normalization = 'sql_sequence'`);
    const sql = fs.readFileSync(path.join(__dirname, 'db', '006_add_design_generations.sql'), 'utf-8');
    await client.query(sql);
    console.log('design_generations table created (or already existed).');
  } finally {
    client.release();
  }
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
