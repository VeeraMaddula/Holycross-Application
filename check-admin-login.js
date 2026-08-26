// One-off diagnostic — run this on your own machine (the sandbox here can't
// reach CockroachDB). Checks what's actually in the users table for the
// ADMIN_EMAIL in .env, and whether ADMIN_PASSWORD in .env actually verifies
// against the stored hash. Safe to delete after running.
require('dotenv').config();
const { query, getPool } = require('./src/sqlPool');
const { verifyPassword } = require('./src/password');

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@holycross.local').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';

  console.log('--- .env values being tested ---');
  console.log('ADMIN_EMAIL:', adminEmail);
  console.log('ADMIN_PASSWORD length:', adminPassword.length, '(not printing the value itself)');
  console.log('');

  console.log('--- all users currently in the DB ---');
  const { rows: allUsers } = await query(
    `SELECT id, email, username, role, active, (password_hash <> '') AS has_password_hash FROM users ORDER BY id`
  );
  if (allUsers.length === 0) {
    console.log('NO ROWS AT ALL in the users table. bootstrapAdmin() should create one on next server start.');
  } else {
    allUsers.forEach(u => {
      console.log(`id=${u.id}  email=${u.email}  username=${u.username || '(none)'}  role=${u.role}  active=${u.active}  has_password_hash=${u.has_password_hash}`);
    });
  }
  console.log('');

  console.log(`--- looking specifically for ${adminEmail} ---`);
  const { rows: match } = await query(`SELECT * FROM users WHERE lower(email) = $1`, [adminEmail]);
  if (!match.length) {
    console.log(`No user found with email ${adminEmail}. That's why login fails — the account doesn't exist under that email.`);
  } else {
    const u = match[0];
    console.log(`Found user id=${u.id}, active=${u.active}, role=${u.role}`);
    if (!u.active) {
      console.log('>>> This account is INACTIVE — that alone would block login regardless of password.');
    }
    const ok = verifyPassword(adminPassword, u.password_hash);
    console.log('Does ADMIN_PASSWORD from .env match the stored hash?', ok ? 'YES — password is correct' : 'NO — password does not match what is stored');
  }

  await getPool().end();
}

main().catch(err => {
  console.error('Diagnostic failed:', err.message);
  process.exit(1);
});
