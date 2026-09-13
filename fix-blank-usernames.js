// One-off — normalizes any existing users.username = '' rows to SQL NULL.
//
// Why: users.username is UNIQUE but not NOT NULL. createUser() used to
// insert '' for "no username given" (bootstrapAdmin, factoryReset's fresh
// admin, "Add Staff" with the field left blank) — but two rows both storing
// literal '' violate the UNIQUE constraint against EACH OTHER, while any
// number of NULLs coexist fine (NULL is never equal to NULL). This is what
// broke factoryReset with "duplicate key value violates unique constraint
// users_username_key" — see src/models/users.js's createUser/
// updateUserProfile for the actual code fix. This script just cleans up
// existing rows so old '' values don't linger and cause the same collision
// somewhere else (e.g. two blank-username staff added via the Users page
// before this fix shipped).
//
// Usage (Render Shell): node fix-blank-usernames.js
require('dotenv').config();
const { query, getPool } = require('./src/sqlPool');

async function main() {
  const { rows: before } = await query(`SELECT id, name, email FROM users WHERE username = ''`);
  console.log(`Found ${before.length} user(s) with username = '':`, before.map(u => `${u.id} (${u.name} <${u.email}>)`));
  if (before.length) {
    await query(`UPDATE users SET username = NULL WHERE username = ''`);
    console.log('Normalized to NULL.');
  } else {
    console.log('Nothing to fix.');
  }
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
