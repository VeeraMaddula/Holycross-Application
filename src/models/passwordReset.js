// Forgot-password-by-email-link flow. Only the SHA-256 hash of the token is
// ever stored — same principle as passwords — so a leaked db.json doesn't
// hand out working reset links.
const crypto = require('crypto');
const { readDb, writeDb } = require('../db');
const { hashPassword } = require('../password');
const { getUserByLoginIdentifier } = require('./users');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Looks the account up the same way login does (username/email/phone), then
// mints a one-time token good for 1 hour. Returns null if no account
// matches — callers should show the same generic "check your email" message
// either way, so this can't be used to discover which identifiers exist.
function createPasswordResetToken(identifier, countryCode) {
  const user = getUserByLoginIdentifier(identifier, countryCode);
  if (!user) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const db = readDb();
  const dbUser = db.users.find(u => u.id === user.id);
  if (!dbUser) return null;
  dbUser.resetTokenHash = hashResetToken(token);
  dbUser.resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  writeDb(db);
  return { user: dbUser, token };
}

function getUserByResetToken(token) {
  if (!token) return null;
  const hash = hashResetToken(token);
  const db = readDb();
  const user = (db.users || []).find(u => u.resetTokenHash === hash);
  if (!user) return null;
  if (!user.resetTokenExpiresAt || new Date(user.resetTokenExpiresAt).getTime() < Date.now()) return null;
  return user;
}

// Sets the new password and burns the token so the link can't be reused.
function resetPasswordWithToken(token, newPassword) {
  const user = getUserByResetToken(token);
  if (!user) return { error: 'This reset link is invalid or has expired. Request a new one.' };
  const db = readDb();
  const dbUser = db.users.find(u => u.id === user.id);
  dbUser.passwordHash = hashPassword(newPassword);
  delete dbUser.resetTokenHash;
  delete dbUser.resetTokenExpiresAt;
  writeDb(db);
  return { user: dbUser };
}

module.exports = { createPasswordResetToken, getUserByResetToken, resetPasswordWithToken };
