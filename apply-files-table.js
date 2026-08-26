// One-off — adds the new `files` table (db/004_add_files_table.sql) to the
// already-running database, without touching any existing table/data.
// Usage: node apply-files-table.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getClient, getPool } = require('./src/sqlPool');

async function main() {
  const client = await getClient();
  try {
    // Defensive — belt and suspenders alongside the ALTER DATABASE default
    // already set by fix-serial-ids.js, so this table's id column is
    // guaranteed to get small sequential ids no matter what.
    await client.query(`SET serial_normalization = 'sql_sequence'`);
    const sql = fs.readFileSync(path.join(__dirname, 'db', '004_add_files_table.sql'), 'utf-8');
    await client.query(sql);
    console.log('files table created (or already existed).');
  } finally {
    client.release();
  }
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
