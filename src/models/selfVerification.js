// Self-service verification codes: used when a logged-in staff member wants
// to change their own login password or kiosk PIN from their Profile page.
// A 6-digit code is emailed to the address on file; they type it back in
// alongside the new value in the same submit. Only the SHA-256 hash of the
// code is ever stored (same principle as the forgot-password reset token in
// passwordReset.js) so a leaked database dump doesn't hand out a working
// code. Code itself now lives as columns on the users row (see
// db/schema.sql) — mutated via users.js's exported setters rather than
// reaching into the table directly, same as every other file that touches
// a user record post-SQL-migration.
//
// Deliberately a separate flow from passwordReset.js: that one is for a
// signed-OUT visitor who has no session yet and proves who they are via a
// clicked email link. This one is for someone already authenticated,
// confirming a change to their own credentials — a short numeric code typed
// back into the same page, not a link.
const crypto = require('crypto');
const { hashPassword } = require('../password');
const { getUserById, setUserSelfVerifyCode, clearUserSelfVerifyCode, setUserPasswordHash, setUserPinHash } = require('./users');

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// purpose: 'password' | 'pin' — kept separate so a code sent for one can't
// be reused to confirm the other.
async function requestVerificationCode(userId, purpose) {
  const user = await getUserById(userId);
  if (!user) return { error: 'User not found.' };
  if (!user.email) return { error: 'No email on file for this account — ask a manager to add one before you can do this.' };
  const code = generateCode();
  const expiresAtIso = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await setUserSelfVerifyCode(user.id, { codeHash: hashCode(code), purpose, expiresAtIso });
  return { user: await getUserById(user.id), code };
}

function checkCode(user, code, purpose) {
  if (!user.selfVerifyCodeHash || user.selfVerifyPurpose !== purpose) {
    return 'Please request a new verification code first.';
  }
  if (!user.selfVerifyExpiresAt || new Date(user.selfVerifyExpiresAt).getTime() < Date.now()) {
    return 'That code has expired — request a new one.';
  }
  if (hashCode(String(code || '').trim()) !== user.selfVerifyCodeHash) {
    return 'Incorrect code. Please check your email and try again.';
  }
  return null;
}

async function confirmPasswordChange(userId, code, newPassword) {
  const user = await getUserById(userId);
  if (!user) return { error: 'User not found.' };
  const err = checkCode(user, code, 'password');
  if (err) return { error: err };
  await setUserPasswordHash(user.id, hashPassword(newPassword));
  await clearUserSelfVerifyCode(user.id);
  return { ok: true };
}

async function confirmPinChange(userId, code, newPin) {
  const user = await getUserById(userId);
  if (!user) return { error: 'User not found.' };
  if (!/^\d{4}$/.test(String(newPin || ''))) return { error: 'PIN must be exactly 4 digits.' };
  const err = checkCode(user, code, 'pin');
  if (err) return { error: err };
  await setUserPinHash(user.id, hashPassword(newPin));
  await clearUserSelfVerifyCode(user.id);
  return { ok: true };
}

module.exports = { requestVerificationCode, confirmPasswordChange, confirmPinChange };
