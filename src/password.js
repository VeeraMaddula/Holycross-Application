// Password hashing using Node's built-in crypto (scrypt) — no extra dependency needed.
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hashBuffer = Buffer.from(hash, 'hex');
  const candidateBuffer = crypto.scryptSync(password, salt, 64);
  if (hashBuffer.length !== candidateBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, candidateBuffer);
}

// Enforced whenever a new password is set (currently: creating a staff
// account from the Users page). Not applied at login — an existing
// password shouldn't suddenly stop working if the rules change later.
const PASSWORD_RULES = 'Password must be 8-16 characters and include at least one uppercase letter, one lowercase letter, and one special character.';
function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 8 || password.length > 16) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}

module.exports = { hashPassword, verifyPassword, isValidPassword, PASSWORD_RULES };
