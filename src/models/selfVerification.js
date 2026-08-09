// Self-service verification codes: used when a logged-in staff member wants
// to change their own login password or kiosk PIN from their Profile page.
// A 6-digit code is emailed to the address on file; they type it back in
// alongside the new value in the same submit. Only the SHA-256 hash of the
// code is ever stored (same principle as the forgot-password reset token in
// passwordReset.js) so a leaked db.json doesn't hand out a working code.
//
// Deliberately a separate flow from passwordReset.js: that one is for a
// signed-OUT visitor who has no session yet and proves who they are via a
// clicked email link. This one is for someone already authenticated,
// confirming a change to their own credentials — a short numeric code typed
// back into the same page, not a link.
const crypto = require('crypto');
const { readDb, writeDb } = require('../db');
const { hashPassword } = require('../password');

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// purpose: 'password' | 'pin' — kept separate so a code sent for one can't
// be reused to confirm the other.
function requestVerificationCode(userId, purpose) {
  const db = readDb();
  const user = (db.users || []).find(u => u.id === Number(userId));
  if (!user) return { error: 'User not found.' };
  if (!user.email) return { error: 'No email on file for this account — ask a manager to add one before you can do this.' };
  const code = generateCode();
  user.selfVerifyCodeHash = hashCode(code);
  user.selfVerifyPurpose = purpose;
  user.selfVerifyExpiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  writeDb(db);
  return { user, code };
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

function clearCode(dbUser) {
  delete dbUser.selfVerifyCodeHash;
  delete dbUser.selfVerifyPurpose;
  delete dbUser.selfVerifyExpiresAt;
}

function confirmPasswordChange(userId, code, newPassword) {
  const db = readDb();
  const user = (db.users || []).find(u => u.id === Number(userId));
  if (!user) return { error: 'User not found.' };
  const err = checkCode(user, code, 'password');
  if (err) return { error: err };
  user.passwordHash = hashPassword(newPassword);
  clearCode(user);
  writeDb(db);
  return { ok: true };
}

function confirmPinChange(userId, code, newPin) {
  const db = readDb();
  const user = (db.users || []).find(u => u.id === Number(userId));
  if (!user) return { error: 'User not found.' };
  if (!/^\d{4}$/.test(String(newPin || ''))) return { error: 'PIN must be exactly 4 digits.' };
  const err = checkCode(user, code, 'pin');
  if (err) return { error: err };
  user.pinHash = hashPassword(newPin);
  clearCode(user);
  writeDb(db);
  return { ok: true };
}

module.exports = { requestVerificationCode, confirmPasswordChange, confirmPinChange };
