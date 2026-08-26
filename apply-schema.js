// One-off — creates all the tables in db/schema.sql on the CockroachDB
// cluster pointed to by DATABASE_URL. Run this once, before any model file
// starts using the SQL backend. Safe to run again later (CREATE TABLE will
// just fail loudly on tables that already exist, rather than silently
// overwriting anything).
//
// Usage: node apply-schema.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, getPool } = require('./src/sqlPool');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf-8');
  console.log('Applying db/schema.sql to', process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'));
  await query(sql);
  console.log('Schema applied successfully.');
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
