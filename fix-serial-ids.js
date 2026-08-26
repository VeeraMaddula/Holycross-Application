// One-off fix for the root cause of "can't login with admin creds".
//
// What's actually wrong: CockroachDB's SERIAL type defaults to backing IDs
// with unique_rowid() — a ~19-digit int8 value (e.g. 1204854009381289985),
// NOT a normal small incrementing 1, 2, 3... like Postgres. That value is
// way past Number.MAX_SAFE_INTEGER (9007199254740991), so every place in
// this app that does Number(id) — starting with getUserById in
// src/models/users.js, used on every single request to look up the logged
// -in user — silently rounds it to the wrong number and can't find you.
//
// The fix: tell CockroachDB to back SERIAL with a normal SQL sequence
// (small, sequential ids) instead of unique_rowid(), then drop and
// recreate the schema while that setting is active, so the tables are
// actually built with it.
//
// First attempt at this script used `ALTER DATABASE ... SET
// serial_normalization = ...`, which only changes the default for BRAND
// NEW sessions — the pooled connection that was already open when the
// ALTER ran kept using its old session value for the rest of the script,
// so the CREATE TABLE right after it still used unique_rowid() (confirmed
// by the "STILL TOO LARGE" verification failure). This version fixes that
// by running everything — the SET, the drops, and the schema recreation —
// on one single dedicated connection, with a plain `SET` (not `ALTER
// DATABASE`), which takes effect immediately in the session that issues it.
//
// Usage: node fix-serial-ids.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getClient, getPool } = require('./src/sqlPool');

async function main() {
  const client = await getClient();
  try {
    console.log('1/4  SET serial_normalization = sql_sequence on this session...');
    await client.query(`SET serial_normalization = 'sql_sequence'`);
    // Also set the database-level default so any future script/connection
    // that recreates tables gets this automatically, without needing to
    // know about this gotcha.
    await client.query(`ALTER DATABASE defaultdb SET serial_normalization = 'sql_sequence'`);

    console.log('2/4  Finding existing tables to drop...');
    const { rows: tables } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    if (tables.length === 0) {
      console.log('     No existing tables found — nothing to drop.');
    } else {
      for (const t of tables) {
        console.log(`     Dropping ${t.table_name}...`);
        await client.query(`DROP TABLE IF EXISTS ${t.table_name} CASCADE`);
      }
    }

    console.log('3/4  Re-applying db/schema.sql on this same session...');
    const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf-8');
    await client.query(sql);

    console.log('4/4  Verifying: creating a throwaway row to confirm ids are now small...');
    const { rows: check } = await client.query(
      `INSERT INTO users (name, email, password_hash, role, color, avatar_path, live_shift_avatar_path, pin_hash)
       VALUES ('__id_check__', '__id_check__@example.invalid', 'x', 'admin', '', '', '', '') RETURNING id`
    );
    const newId = check[0].id;
    await client.query(`DELETE FROM users WHERE email = '__id_check__@example.invalid'`);
    const isSafe = Number(newId) <= Number.MAX_SAFE_INTEGER && String(Number(newId)) === String(newId);
    console.log(`     New id generated: ${newId} (${isSafe ? 'GOOD — small sequential id, safe for JS Number()' : 'STILL TOO LARGE — something else is wrong'})`);

    if (!isSafe) {
      console.log('');
      console.log('Still broken — do not proceed to restart the server. Paste this full output back so it can be investigated further.');
      process.exitCode = 1;
    } else {
      console.log('');
      console.log('Done. Restart the server (node src/server.js) — bootstrapAdmin will recreate your admin account with a normal small id, and login should work.');
    }
  } finally {
    client.release();
  }
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
