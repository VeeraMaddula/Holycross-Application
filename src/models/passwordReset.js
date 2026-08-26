// Forgot-password-by-email-link flow. Only the SHA-256 hash of the token is
// ever stored — same principle as passwords — so a leaked database dump
// doesn't hand out working reset links. Token itself now lives as columns
// on the users row (see db/schema.sql) — mutated via users.js's exported
// setUserResetToken/getUserByResetTokenHash/clearUserResetToken/
// setUserPasswordHash rather than reaching into the table directly, same
// as every other file that touches a user record post-SQL-migration.
const crypto = require('crypto');
const { hashPassword } = require('../password');
const {
  getUserByLoginIdentifier, setUserResetToken, getUserByResetTokenHash,
  clearUserResetToken, setUserPasswordHash, getUserById
} = require('./users');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Looks the account up the same way login does (username/email/phone), then
// mints a one-time token good for 1 hour. Returns null if no account
// matches — callers should show the same generic "check your email" message
// either way, so this can't be used to discover which identifiers exist.
async function createPasswordResetToken(identifier, countryCode) {
  const user = await getUserByLoginIdentifier(identifier, countryCode);
  if (!user) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  await setUserResetToken(user.id, hashResetToken(token), expiresAt);
  return { user: await getUserById(user.id), token };
}

async function getUserByResetToken(token) {
  if (!token) return null;
  const user = await getUserByResetTokenHash(hashResetToken(token));
  if (!user) return null;
  if (!user.resetTokenExpiresAt || new Date(user.resetTokenExpiresAt).getTime() < Date.now()) return null;
  return user;
}

// Sets the new password and burns the token so the link can't be reused.
async function resetPasswordWithToken(token, newPassword) {
  const user = await getUserByResetToken(token);
  if (!user) return { error: 'This reset link is invalid or has expired. Request a new one.' };
  await setUserPasswordHash(user.id, hashPassword(newPassword));
  await clearUserResetToken(user.id);
  return { user: await getUserById(user.id) };
}

module.exports = { createPasswordResetToken, getUserByResetToken, resetPasswordWithToken };
