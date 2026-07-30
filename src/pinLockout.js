// Per-account lockout for the kiosk's 4-digit PIN.
//
// A 4-digit PIN only has 10,000 possible values — trivial to brute-force in
// seconds without this. IP-based rate limiting (see rateLimiters.js) helps,
// but the kiosk tablet is a single shared device that legitimately makes
// many requests a day, so an IP limit alone can't be tuned tight enough to
// stop a determined attacker with access to that tablet. Locking the
// *account* after repeated wrong guesses closes the gap regardless of where
// the requests come from.
//
// Deliberately in-memory rather than stored in db.json — this is meant to
// slow down/block a live brute-force attempt, not survive a server
// restart, and it keeps every clock-in request from having to read+write
// the whole JSON database.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const attempts = new Map(); // userId -> { count, lockedUntil }

function isLocked(userId) {
  const rec = attempts.get(Number(userId));
  if (!rec || !rec.lockedUntil) return false;
  if (Date.now() > rec.lockedUntil) {
    attempts.delete(Number(userId));
    return false;
  }
  return true;
}

function minutesRemaining(userId) {
  const rec = attempts.get(Number(userId));
  if (!rec || !rec.lockedUntil) return 0;
  return Math.max(1, Math.ceil((rec.lockedUntil - Date.now()) / 60000));
}

function recordFailure(userId) {
  const id = Number(userId);
  const rec = attempts.get(id) || { count: 0, lockedUntil: null };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  attempts.set(id, rec);
  return rec;
}

function recordSuccess(userId) {
  attempts.delete(Number(userId));
}

module.exports = { isLocked, minutesRemaining, recordFailure, recordSuccess, MAX_ATTEMPTS, LOCKOUT_MS };
