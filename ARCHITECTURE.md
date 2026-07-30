# Architecture

A guide for an engineer opening this codebase for the first time: how it's organized, how a
request flows through it, and where to find (or add) things. For setup/running instructions see
`README.md`.

## The shape of the app

This is a classic server-rendered monolith, not an API + frontend split:

```
Browser  <---HTML--->  Express routes  <--->  models/ (business logic)  <--->  data/db.json
                             |
                          EJS views (server-rendered HTML)
```

- **Express** (`src/server.js`) handles routing, sessions, and security middleware.
- **EJS views** (`src/views/`) render HTML server-side — there's no separate frontend build step,
  no React/Vue, no API layer to keep in sync. A page load or form submit gets you a full new page
  (plus a handful of small `fetch()` calls for things that poll live status, like the Tables page
  or the kiosk clock).
- **`src/models/`** holds all the business logic and data access — routes call into models,
  models read/write the database, and models never render HTML or know about `req`/`res`.
- **The database is a single JSON file** (`data/db.json`), read and rewritten whole on every
  write. See "Why a JSON file instead of a real database?" below.

If you've worked on a typical Express/MVC app before, the mental model is: `routes/` are
controllers, `models/` is the model layer, `views/` is the view layer — the same three-part split,
just without an ORM or SQL in the middle.

## Folder map

```
src/
  server.js          Express app setup: middleware, security headers, route mounting
  db.js              Reads/writes data/db.json; defines the default empty-database shape
  models/            Business logic, one file per domain (see below)
  models.js          Barrel — re-exports everything from models/ under one require('./models')
  routes/            One file per URL area (bookings.js, users.js, kiosk.js, ...) — thin: parse
                     request, call models, render a view or redirect
  views/             EJS templates, mirroring the routes/ structure where it makes sense
  middleware.js      requireAuth + one requireXAccess function per gated feature
  csrf.js            CSRF token generation/verification (see "Security" below)
  rateLimiters.js    express-rate-limit configs for login/PIN/forgot-password/public booking
  pinLockout.js      Per-account lockout for the kiosk's 4-digit PIN
  notify.js          Sends email/SMS and builds their copy; also runs the reminder/duty-sweep
                     cron schedules
  privacyPolicy.js   Content for the staff + customer privacy notices
  googleCalendar.js  Google Calendar API sync (service-account based)
  roles.js            The role list, labels, and MANAGER_ROLES grouping
  password.js, phoneUtils.js, dateUtils.js, calendarLinks.js, duties.js, dutyWindows.js, sms.js
                     Small, focused utility modules
data/
  db.json            The actual database (git-ignored — see db.js for the schema/defaults)
tests/
  *.test.js          node:test unit tests against models/ functions, using an isolated DB file
                     (DB_FILE_PATH env var) so tests never touch real data
```

### `models/` — one file per domain

`src/models.js` itself is a **barrel**: a 150-ish line file that just requires each domain module
under `src/models/` and re-exports their functions under a single object, so every route file can
keep doing `const models = require('../models')` without knowing (or caring) that the
implementation is split up. This was a deliberate choice over renaming/moving the import in every
route file — the public API (function names) didn't change at all, only where each function's
code physically lives.

| File | Covers |
|---|---|
| `models/shared.js` | Pure helper functions used by more than one domain (time-window math, role normalization, the staff colour palette, booking music/food builders) |
| `models/tables.js` | Table inventory + live occupied/reserved/available status |
| `models/bookings.js` | Booking CRUD, conflict detection, approval workflow |
| `models/menu.js` | Menu content + events list |
| `models/notificationsLog.js` | The Notifications page's audit log (not the sending itself — that's `notify.js`) |
| `models/settings.js` | App-wide settings (hours, slot duration, reminder timing) |
| `models/users.js` | Staff accounts: lookup, creation, profile edits, per-feature access grants |
| `models/passwordReset.js` | Forgot-password-by-email-link tokens |
| `models/cashSafe.js` | Cash Safe Log entries + the adjustable lodgement target |
| `models/calendarSync.js` | Local bookkeeping for Google Calendar sync (event IDs, last-synced time) |
| `models/clockEntries.js` | Clock in/out records, staff status, and the kiosk PIN |
| `models/roster.js` | Per-date shift assignments |
| `models/dutyChecklist.js` | The Bar Staff Duties checklist + escalation reports |
| `models/requests.js` | Staff-to-staff/manager requests (stock, leave, other) |
| `models/staffReports.js` | "Report an Issue" — staff-to-manager reports |
| `models/admin.js` | Clear-data / factory-reset (Settings page danger zone) |

A few submodules depend on each other directly — e.g. `clockEntries.js` needs `users.js`'s
`listUsers`, `dutyChecklist.js` needs `clockEntries.js`'s `listAllStaffStatus`. They require each
other by relative path within `models/`, **never** through the `models.js` barrel — requiring the
barrel from inside a submodule would create a circular require (`models.js` → submodule →
`models.js` → ...).

**Adding a new domain?** Create `src/models/yourDomain.js`, export its functions, `require` it in
`src/models.js`, and add its functions to that barrel's `module.exports`. Nothing else changes.

### `routes/` and `views/`

Each `routes/*.js` file is mounted in `server.js` against a URL prefix, usually with
`requireAuth` and a feature-specific `requireXAccess` middleware in front of it:

```js
app.use('/cash-safe', requireAuth, requireCashSafeAccess, require('./routes/cashSafe'));
```

Routes stay thin: read `req.body`/`req.params`, call a `models` function, then either
`res.render(...)` a view or `res.redirect(...)`. Validation that's specific to one form lives in
the route; validation that's a business rule (e.g. "can't double-book a table") lives in the
matching `models/` file so it can never be bypassed by a different route calling the same model
function.

Views mirror the route structure (`routes/bookings.js` ↔ `views/bookings/*.ejs`) and share layout
through `views/partials/head.ejs` (page `<head>`) and `views/partials/sidebar.ejs` (nav + role
-based menu visibility).

## Request flow example

A staff member clicking "New Booking" and submitting the form:

1. `GET /bookings/new` → `routes/bookings.js` → renders `views/bookings/form.ejs` with the table
   list from `models/tables.js`.
2. Form POSTs to `/bookings` with a `_csrf` hidden field (see Security below).
3. `routes/bookings.js`'s `POST /` handler calls `models.createBooking(...)`.
4. `models/bookings.js` reads the whole DB via `db.js`, checks for a table/time conflict
   (`findConflict`), decides the booking's status (`confirmed` or `pending_approval`), appends the
   new booking, and writes the whole DB back.
5. The route fires a confirmation email via `notify.js` (fire-and-forget — it doesn't block the
   response) and redirects to the new booking's detail page.

## Why a JSON file instead of a real database?

This is a single-location app with a handful of concurrent staff users — not a scale where a real
RDBMS earns its complexity. `db.js` reads the whole file into memory and rewrites it whole on
every write (via a temp-file-then-rename, so a crash mid-write can't corrupt it). The trade-off:
every write is O(size of the whole database), and there's no real transaction isolation between
concurrent writes. That's a genuine scalability ceiling worth knowing about if this ever needs to
support many locations or heavy concurrent write traffic — at that point, migrating `db.js`'s
`readDb`/`writeDb` functions to a real database becomes the natural next step, and because every
other file only ever talks to the database through `db.js`, that migration wouldn't require
touching `models/` or `routes/` at all.

## Security

See `SECURITY.md` for the full list of protections and the reasoning behind each one. Summary for
orientation:

- **No SQL** — there's no SQL database, so classic SQL injection doesn't apply here. The
  equivalent risks for this architecture (XSS, CSRF, path traversal on file uploads, brute force)
  are what's actually guarded against.
- **CSRF protection** (`src/csrf.js`) on every state-changing request, staff and public alike.
- **Rate limiting** (`src/rateLimiters.js`) on login, password reset, kiosk PIN, and the public
  booking form.
- **Per-account lockout** (`src/pinLockout.js`) on the kiosk's 4-digit PIN, on top of rate
  limiting — a 4-digit PIN only has 10,000 combinations, so both matter.
- **Security headers** via `helmet` in `server.js` (clickjacking, MIME-sniffing, HSTS, a scoped
  Content-Security-Policy).
- **Session hardening** — `httpOnly`/`sameSite`/`secure` cookie flags, and the app refuses to
  start in production with a default/missing `SESSION_SECRET`.
- Passwords and kiosk PINs are hashed with `scrypt` + a timing-safe comparison
  (`src/password.js`) — never stored or logged in plain text.
- File uploads (photos) are restricted by MIME type and size, saved under randomized filenames
  outside `public/`, and served only through authenticated routes that sanitize the requested
  filename with `path.basename()` to block path traversal.

## Testing

`npm test` runs `tests/*.test.js` (Node's built-in `node:test`) against `src/models/` functions,
using `DB_FILE_PATH` to point at a throwaway JSON file so tests never touch `data/db.json`. There's
no HTTP-level test suite yet (routes are currently verified by manual/scripted `curl` smoke tests
during development) — a good next step for anyone picking this up would be adding
`supertest`-based route tests alongside the existing model tests.
