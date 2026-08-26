// One-off — unblocks the "typing the admin's email logs me into Veera's
// account instead" bug. Root cause: login checks username before email
// (getUserByLoginIdentifier in src/models/users.js), and Veera's account
// (id 3, email jagannadham.ireland.edu@gmail.com) has its username field
// mistakenly set to the admin's email string
// ("waterfordholycross@gmail.com") — so typing that string as a login
// identifier matches Veera by username before the admin's real email is
// ever checked. Can't fix this through the Users page UI since it's
// admin-only and the admin account is exactly what's unreachable right
// now — this updates the row directly instead.
//
// Usage: node fix-veera-username.js
require('dotenv').config();
const { query, getPool } = require('./src/sqlPool');

const VEERA_EMAIL = 'jagannadham.ireland.edu@gmail.com';
const NEW_USERNAME = 'veeramaddula';

async function main() {
  const { rows: before } = await query(`SELECT id, name, email, username, role FROM users WHERE lower(email) = $1`, [VEERA_EMAIL]);
  if (!before.length) {
    console.log(`No user found with email ${VEERA_EMAIL} — nothing to fix.`);
    await getPool().end();
    return;
  }
  const veera = before[0];
  console.log(`Found: id=${veera.id} name=${veera.name} username=${veera.username} role=${veera.role}`);

  const { rows: clash } = await query(`SELECT id FROM users WHERE lower(username) = $1 AND id <> $2`, [NEW_USERNAME.toLowerCase(), veera.id]);
  if (clash.length) {
    console.log(`FAILED: another user (id=${clash[0].id}) already has username "${NEW_USERNAME}". Pick a different one.`);
    await getPool().end();
    process.exit(1);
  }

  await query(`UPDATE users SET username = $1 WHERE id = $2`, [NEW_USERNAME, veera.id]);
  console.log(`Done. id=${veera.id}'s username is now "${NEW_USERNAME}". Admin login by email should work correctly now.`);
  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
