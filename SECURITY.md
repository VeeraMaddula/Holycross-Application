# Security

This documents a security review done on the app and what came out of it — what was found, what
was fixed, what was deliberately left alone (and why), and how to verify any of it yourself.

## "Is this vulnerable to SQL injection?"

No — there's no SQL database anywhere in this app. `data/db.json` is read and parsed with
`JSON.parse`/`JSON.stringify` (`src/db.js`), not a query language, so classic SQL injection simply
doesn't apply here. The equivalent risks for a JSON-file/server-rendered-HTML app are different
(cross-site scripting, cross-site request forgery, path traversal on file uploads, brute force on
low-entropy credentials) — those are what the rest of this document covers.

## What was reviewed

- Authentication & session handling (`routes/auth.js`, `src/server.js`)
- The kiosk's 4-digit PIN flow (`routes/kiosk.js`) — a much smaller keyspace than a password
- Every `<form method="POST">` and `fetch()` call across `src/views/` (~70 forms) for CSRF exposure
- Every EJS view for unescaped (`<%-`) output of user-controlled data (XSS)
- File upload handling (Cash Safe photos, clock-in/break selfies, avatars, report attachments)
- Role/permission checks (`middleware.js`) for privilege-escalation gaps
- `npm audit` against all dependencies
- Session cookie configuration and the `SESSION_SECRET` fallback behavior
- CSV export (Timesheets) for spreadsheet formula injection

## Fixed

**CSRF protection (`src/csrf.js`).** Previously, none of the ~70 POST forms or `fetch()`-based
actions (kiosk clock-in, profile avatar upload) carried any CSRF token — a malicious page open in
another tab could have silently submitted a form to this app using the victim's own login cookie
(e.g. an auto-submitting form pointed at `/settings/factory-reset`). Every session now gets a
random token, rendered into every form as a hidden `_csrf` field (or passed as an `X-CSRF-Token`
header for `fetch()` calls), and checked with a timing-safe comparison on every non-GET request.

**Kiosk PIN brute force (`src/pinLockout.js` + `src/rateLimiters.js`).** A 4-digit PIN has only
10,000 possible values — trivially brute-forceable in seconds with no protection. Added: (a) a
per-account lockout after 5 wrong attempts (15-minute cooldown), independent of where the requests
come from, and (b) a backstop IP-based rate limit on the verify/action endpoints. Login,
forgot-password, and forgot-PIN also got rate limits, since none of those had any before either.

**Security headers (`helmet` in `server.js`).** Added clickjacking protection
(`frame-ancestors 'none'`), MIME-sniffing protection, HSTS, and a Content-Security-Policy scoped to
this app's actual script/style sources (`'self'` plus the specific `cdnjs.cloudflare.com` libraries
it loads — CropperJS, FullCalendar). The CSP allows `'unsafe-inline'` for scripts/styles rather
than the stricter default, because the views use inline `<script>` blocks and `onclick=`/`style=`
attributes throughout; migrating those to a nonce-based CSP is a larger, view-by-view follow-up
(see "Left for later" below).

**Session cookie hardening.** Added explicit `httpOnly`, `sameSite: 'lax'`, and `secure` (in
production) flags. The app now also refuses to start in production if `SESSION_SECRET` is unset or
still the placeholder value — previously it would silently fall back to a public, guessable
secret, which would let anyone who reads the source code forge a valid session cookie.

**Dependency vulnerability (`nodemailer`).** `npm audit` flagged several HIGH-severity issues in
the installed `nodemailer` version (SMTP command injection, CRLF header injection, an SSRF via its
`raw` message option). Upgraded to the patched `9.0.3`.

**CSV formula injection (`routes/timesheets.js`).** The Timesheets CSV export already quoted
fields to stop column-spillover, but a cell value starting with `=`, `+`, `-`, or `@` is still
treated as a formula by Excel/Sheets when the file is opened. Added the standard fix (a leading
apostrophe forces plain-text interpretation) — same approach Google/Microsoft's own CSV exporters
use.

**Explicit request body size limits.** `express.json`/`express.urlencoded` now have an explicit
1MB cap instead of relying on the implicit default, so the limit is a documented decision rather
than an accident of the library's defaults. (File uploads have their own, separate multer limits —
this only affects ordinary form/JSON bodies.)

## Reviewed and already solid (no changes needed)

- **Password/PIN hashing** (`src/password.js`) — `scrypt` with a random salt and a timing-safe
  comparison. No changes needed.
- **File upload validation** — every upload route (Cash Safe, kiosk, profile avatar, reports)
  already restricted MIME types, capped file size, generated randomized filenames, and served
  files back only through routes that sanitize the requested filename with `path.basename()` to
  block path traversal.
- **XSS** — every EJS view uses the auto-escaping `<%=` for user-controlled data. The only raw
  `<%-` output found was for `include()`-ing trusted, hardcoded partials (`head.ejs`,
  `sidebar.ejs`), never for rendering user input.
- **Privilege escalation** — role changes go through `models.setUserRole`, which normalizes any
  submitted role against a fixed allow-list (an unrecognized value silently falls back to
  `bar_staff` rather than being stored as-is), and the whole `/users` router is gated behind
  `requireAdmin`.
- **Password-reset email enumeration** — `forgot-password` always shows the same "check your
  email" message whether or not the identifier matched an account.

## Left for later (deliberately not fixed now)

**`node-cron`'s transitive `uuid` dependency** (moderate severity, per `npm audit`). The only fix
is `node-cron@4`, which requires Node.js **20+** — this project's documented requirement is Node
**18+** (`README.md`), and bumping it wasn't confirmed with whoever manages the deployment
environment. The vulnerable code path (a buffer-bounds issue in ID generation) isn't reachable by
any attacker-controlled input in how this app uses `node-cron` (purely internal timer scheduling,
no external input flows into it), so the real-world risk is low. Revisit this once/if the Node
version requirement is raised.

**Nonce-based CSP.** The current CSP allows `'unsafe-inline'` for scripts and styles (see above).
Removing that in favor of per-request nonces would require adding a `nonce="..."` attribute to
every inline `<script>` tag and `onclick=`/`style=` attribute across ~30 view files — a large,
mechanical but risky change given how much of the UI's interactivity depends on inline handlers.
Worth doing as a dedicated follow-up, not bundled into this pass.

## What this doesn't (and can't) cover

**Network-level attacks ("packet attacks" / DDoS).** Everything above is application-layer — code
running inside the Node process. A large-scale network flood (SYN floods, volumetric DDoS, etc.)
reaches the server's network interface before any of this code ever runs, so no amount of
in-app rate limiting can fully stop one. `rateLimiters.js`'s `globalLimiter` blunts *basic scripted
abuse* (a script hammering the app with HTTP requests), which is a meaningfully different and much
smaller threat than a real DDoS. Once this app is deployed publicly, real protection against
network-level flooding has to come from the hosting layer — a host or CDN with built-in DDoS
mitigation (e.g. Cloudflare, or most modern PaaS providers) sitting in front of the app.

## How to verify any of this yourself

- `npm audit` — dependency vulnerabilities.
- `npm test` — the existing unit test suite (unaffected by any of the above; none of this changed
  business logic, only added protective layers around it).
- Manual check: try submitting any form with dev tools open and strip out the hidden `_csrf`
  field — the request should come back `403`.
- Manual check: hit `/kiosk/verify` with a wrong PIN 5 times in a row for the same `userId` — the
  6th attempt (even with the *correct* PIN) should come back `429` until the lockout window
  passes.
