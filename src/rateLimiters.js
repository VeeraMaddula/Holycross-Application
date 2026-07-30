// IP-based request throttling, using express-rate-limit.
//
// This is application-layer protection against scripted abuse (password
// guessing, PIN guessing, hammering the forgot-password/forgot-pin
// endpoints to spam a customer or a manager's inbox). It does NOT protect
// against network-layer flooding/DDoS — that has to be handled by
// infrastructure in front of the app (a host or CDN like Cloudflare) once
// this is deployed publicly; no amount of code inside an Express app can
// stop a large-scale packet flood from reaching it in the first place.
const rateLimit = require('express-rate-limit');

// Shared response so a throttled request gets a normal-looking page instead
// of a bare JSON error, since most of these are hit by an HTML form.
function handler(req, res) {
  res.status(429).render('429', { retryAfterMinutes: Math.ceil((res.getHeader('Retry-After') || 60) / 60) });
}

// Login: slow down password-guessing without locking out genuine staff who
// mistype a few times in a row.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler
});

// Forgot-password / forgot-PIN: these trigger an email/notification, so on
// top of guessing risk they're also a spam vector against a real inbox.
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler
});

// Kiosk PIN check: the tablet is shared and genuinely busy at shift
// changes, so this stays generous — the real brute-force defense is the
// per-account lockout in pinLockout.js. This is just a backstop against a
// script hammering the endpoint outright.
const kioskPinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler
});

// Public booking form: prevents a script from flooding the restaurant with
// fake reservations (and the emails/SMS each one triggers).
const publicBookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler
});

// General baseline across the whole app — generous enough that no real
// user ever notices it, tight enough to blunt a basic scripted flood.
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler
});

module.exports = { loginLimiter, forgotLimiter, kioskPinLimiter, publicBookingLimiter, globalLimiter };
