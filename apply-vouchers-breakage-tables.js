// One-off — adds the new vouchers, voucher_redemptions, and
// breakage_reports tables (db/005_add_vouchers_and_breakage.sql) to the
// already-running database, without touching any existing table/data.
// Usage: node apply-vouchers-breakage-tables.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getClient, getPool } = require('./src/sqlPool');

async function main() {
  const client = await getClient();
  try {
    // Defensive — see fix-serial-ids.js for why this matters: without it,
    // these tables' SERIAL id columns would default to CockroachDB's
    // unique_rowid() (~19-digit ids, past JS's safe integer range) instead
    // of small sequential ones.
    await client.query(`SET serial_normalization = 'sql_sequence'`);
    const sql = fs.readFileSync(path.join(__dirname, 'db', '005_add_vouchers_and_breakage.sql'), 'utf-8');
    await client.query(sql);
    console.log('vouchers, voucher_redemptions, and breakage_reports tables created (or already existed).');
  } finally {
    client.release();
  }
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
