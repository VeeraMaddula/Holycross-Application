// One-off — applies db/012_redesign_duties_training.sql (task #209, part 1).
// duty_sections/duty_completions/duty_reports/training_items are dropped
// and recreated — their model files have only ever used
// readDb()/writeDb(), never query().
// Usage: node apply-redesign-duties-training.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getClient, getPool } = require('./src/sqlPool');

async function main() {
  const client = await getClient();
  try {
    await client.query(`SET serial_normalization = 'sql_sequence'`);
    const sql = fs.readFileSync(path.join(__dirname, 'db', '012_redesign_duties_training.sql'), 'utf-8');
    await client.query(sql);
    console.log('duty_sections/duty_completions/duty_reports/training_items redesigned.');
  } finally {
    client.release();
  }
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
