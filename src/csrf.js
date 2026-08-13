// Cross-Site Request Forgery (CSRF) protection.
//
// Without this, any website the user has open in another tab could silently
// submit a form (or fire a fetch()) to this app using the user's own login
// cookie — e.g. a hidden auto-submitting <form> pointed at
// /settings/factory-reset. The browser sends cookies automatically on
// cross-site requests, so the cookie alone doesn't prove the request came
// from OUR page.
//
// The fix (the standard "synchronizer token" pattern): generate a random
// token per session, hand it to every page we render, and require it back
// on every state-changing request — as a hidden `_csrf` form field, or an
// `X-CSRF-Token` header for fetch()-driven requests. A third-party site has
// no way to read this token (browsers block cross-origin reads of our
// page's HTML/JS), so it can't forge a request that includes it.
const crypto = require('crypto');

const TOKEN_BYTES = 32;
// Only these methods are required to be "safe" (no side effects) by HTTP
// convention, so only non-safe methods need a token check.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  }
  return req.session.csrfToken;
}

// Mounted globally, right after the session middleware in server.js — runs
// on every request, for logged-in staff and anonymous customers alike (the
// public booking form needs a token too).
// The design-agent API (/api/marketing-agent/...) is called by a scheduled
// Claude session, not a browser — there's no page/session for it to have
// read a per-session CSRF token from, and no cookie for a forged cross-site
// request to ride along on in the first place. It's protected instead by its
// own MARKETING_AGENT_TOKEN Bearer-token check (see routes/marketingAgentApi.js),
// which serves the same purpose here: proving the request came from
// somewhere that's supposed to be able to make it.
const CSRF_EXEMPT_PREFIXES = ['/api/marketing-agent'];

function csrfMiddleware(req, res, next) {
  if (CSRF_EXEMPT_PREFIXES.some(p => req.path.startsWith(p))) return next();

  const token = ensureToken(req);
  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) return next();

  const supplied = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || '';
  const expected = Buffer.from(token, 'hex');
  const actual = Buffer.from(String(supplied), 'hex');
  // timingSafeEqual throws if lengths differ, so check that first — an
  // attacker who can't even match the length learns nothing from the
  // comparison either way.
  const valid = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  if (!valid) {
    return res.status(403).render('403');
  }
  next();
}

module.exports = { csrfMiddleware };
