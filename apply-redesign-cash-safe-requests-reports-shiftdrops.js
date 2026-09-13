// One-off — applies db/011_redesign_cash_safe_requests_reports_shiftdrops.sql
// (task #208). cash_logs/cash_lodgement_history/reports/shift_drops are
// dropped and recreated (their model files have only ever used
// readDb()/writeDb(), never query() — confirmed 0 rows possible in any of
// them); requests just gets the recipient_user_id/recipient_name columns
// ALTER-ed in, since its existing shape was otherwise fine.
// Usage: node apply-redesign-cash-safe-requests-reports-shiftdrops.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getClient, getPool } = require('./src/sqlPool');

async function main() {
  const client = await getClient();
  try {
    // Defensive — new SERIAL columns (cash_logs, cash_lodgement_history,
    // reports, shift_drops are all recreated) should use small sequential
    // ids via an actual SQL sequence, not CockroachDB's ~19-digit
    // unique_rowid() default. See fix-serial-ids.js for the original fix;
    // this is belt-and-suspenders on this connection.
    await client.query(`SET serial_normalization = 'sql_sequence'`);
    const sql = fs.readFileSync(path.join(__dirname, 'db', '011_redesign_cash_safe_requests_reports_shiftdrops.sql'), 'utf-8');
    await client.query(sql);
    console.log('cash_logs/cash_lodgement_history/reports/shift_drops redesigned; requests got recipient_user_id/recipient_name columns.');
  } finally {
    client.release();
  }
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
