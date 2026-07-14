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

module.exports = { hashPassword, verifyPassword };
