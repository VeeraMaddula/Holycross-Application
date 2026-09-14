// One-off — adds bookings.escalation_tier
// (db/014_add_booking_escalation_tier.sql) for the website booking
// approval SLA/escalation sweep. Idempotent (ADD COLUMN IF NOT EXISTS) —
// safe to re-run.
// Usage: node apply-booking-escalation-tier.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getClient, getPool } = require('./src/sqlPool');

async function main() {
  const client = await getClient();
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'db', '014_add_booking_escalation_tier.sql'), 'utf-8');
    await client.query(sql);
    console.log('bookings.escalation_tier column added (or already existed).');
  } finally {
    client.release();
  }
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
