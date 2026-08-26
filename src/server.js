require('dotenv').config();
require('./persist').setupPersistence();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const { ensureDb } = require('./db');
const models = require('./models');
const { hashPassword } = require('./password');
const { requireAuth, requireAdmin, requireTimesheetAccess, requireRosterAccess, requireRequestsAccess, requireNotificationsAccess, requireKioskPageAccess, requireDutiesAccess, requireReportAccess, requireCashSafeAccess, requireLogsAccess, requireTrainingAccess } = require('./middleware');
// requireTimesheetEditAccess (admin/senior_manager only) and
// requireTrainingEditAccess (manager-tier / canEditTraining only) are
// applied inside their own route files, layered on top of the broader
// view-level mount gates below — not needed here.
const { ROLES, ROLE_LABELS } = require('./roles');
const notify = require('./notify');
const googleCalendar = require('./googleCalendar');
const { STAFF_PRIVACY_VERSION } = require('./privacyPolicy');
const { csrfMiddleware } = require('./csrf');
const { globalLimiter } = require('./rateLimiters');

ensureDb();

// A session cookie signed with a known/guessable secret can be forged —
// anyone who knows the secret can mint themselves a valid "logged in as
// admin" cookie without ever knowing a password. Refuse to boot in
// production with the placeholder default; just warn loudly everywhere
// else (local dev / tests) so this never silently ships unnoticed.
const DEFAULT_SESSION_SECRET = 'change-this-secret-please';
const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
if (SESSION_SECRET === DEFAULT_SESSION_SECRET) {
  const message = 'SESSION_SECRET is not set in .env (or is still the placeholder) — sessions are signed with a public, guessable value. Set SESSION_SECRET to a long random string before deploying.';
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to start: ' + message);
    process.exit(1);
  }
  console.warn('WARNING: ' + message);
}

// Bootstrap an initial admin account on first run, from .env credentials.
// Now async — listUsers()/createUser() query CockroachDB, not the JSON
// file — so this (and everything that depends on it existing) has to wait
// for it via the startServer() IIFE below instead of running inline at
// module load like it used to.
async function bootstrapAdmin() {
  if ((await models.listUsers()).length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@holycross.local').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'changeme123';
    await models.createUser({ name: 'Admin', email, passwordHash: hashPassword(password), role: 'admin' });
    console.log(`Created initial admin user "${email}" using ADMIN_EMAIL / ADMIN_PASSWORD from .env`);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Needed so express-session's "secure cookie" logic and req.secure see the
// real scheme when the app is deployed behind a reverse proxy / load
// balancer that terminates TLS (the app itself would otherwise only ever
// see a plain http:// connection from the proxy).
if (isProd) app.set('trust proxy', 1);

// Security headers: blocks this app from being framed by another site
// (clickjacking), stops browsers guessing/sniffing content types, adds
// HSTS, etc. contentSecurityPolicy is configured explicitly below rather
// than left on helmet's strict default, because the app's views rely on
// inline <script>/<style> blocks and onclick="" handlers throughout — a
// default-strict CSP would break the UI. This still blocks the things that
// matter most (framing, plugins/objects, form hijacking to another origin)
// while allowing the small, fixed list of CDN hosts the app actually loads
// (cropperjs, FullCalendar). Migrating the inline scripts to a nonce-based
// CSP is a good follow-up but is a much larger, view-by-view change.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      // CSP treats inline event-handler attributes (onclick=, onsubmit=,
      // onchange=, onerror=...) and inline style="" attributes as SEPARATE
      // directives from scriptSrc/styleSrc — helmet defaults both to 'none'
      // if not set explicitly, which would silently break the onclick/
      // onsubmit/style="" attributes used throughout every view. Caught by
      // live-testing this against the real login page before shipping it.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Explicit body-size caps — the default (100kb) is reasonable already, but
// setting it here makes the limit an intentional decision instead of an
// implicit default, and keeps a single place to tune it. File uploads
// (photos) go through multer on individual routes with their own limits,
// so this only bounds ordinary form/JSON bodies.
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Generous, app-wide throttle — a backstop against basic scripted flooding.
// This is an application-layer mitigation only; it can't stop a real
// network-level flood from reaching the server at all. True DDoS
// protection belongs in front of the app (e.g. a host/CDN like Cloudflare)
// once this is deployed publicly. Tighter, endpoint-specific limits for
// login/PIN/forgot-password live in rateLimiters.js and are applied on
// those individual routes.
app.use(globalLimiter);

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12, // 12 hours
    httpOnly: true, // never readable from client-side JS
    sameSite: 'lax', // blocks the cookie being sent on most cross-site requests
    secure: isProd // only sent over HTTPS once actually deployed
  }
}));

// CSRF protection — must come after session() (it needs req.session) and
// before any route that renders a form or handles a POST. See csrf.js for
// the full explanation.
app.use(csrfMiddleware);

// Make current path + logged-in user available to all views.
// Looks the user up fresh from the DB each request (not just the session) so
// avatar/role changes show up immediately without needing to log out and back in.
app.use(async (req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.isAuthed = !!(req.session && req.session.userId);
  if (req.session && req.session.userId) {
    const dbUser = await models.getUserById(req.session.userId);
    res.locals.currentUser = dbUser
      ? {
          id: dbUser.id,
          name: dbUser.name,
          firstName: (dbUser.name || '').trim().split(/\s+/)[0] || dbUser.name,
          role: dbUser.role,
          roleLabel: ROLE_LABELS[dbUser.role] || dbUser.role,
          avatarPath: dbUser.liveShiftAvatarPath || dbUser.avatarPath || '',
          canViewTimesheets: !!dbUser.canViewTimesheets,
          canManageRoster: !!dbUser.canManageRoster,
          canMakeRequests: !!dbUser.canMakeRequests,
          canBookFunctions: !!dbUser.canBookFunctions,
          canViewNotifications: !!dbUser.canViewNotifications,
          canManageCashSafe: !!dbUser.canManageCashSafe,
          canViewLogs: !!dbUser.canViewLogs,
          canEditDuties: !!dbUser.canEditDuties,
          canEditTraining: !!dbUser.canEditTraining,
          privacyPolicyVersionRaw: dbUser.privacyPolicyVersion || null,
          privacyPolicyAcceptedAtRaw: dbUser.privacyPolicyAcceptedAt || null
        }
      : { name: req.session.name, firstName: req.session.name, role: req.session.role, roleLabel: ROLE_LABELS[req.session.role] || req.session.role, avatarPath: '', canViewTimesheets: false, canManageRoster: false, canMakeRequests: false, canBookFunctions: false, canViewNotifications: false, canManageCashSafe: false, canViewLogs: false, canEditDuties: false, canEditTraining: false, privacyPolicyVersionRaw: null, privacyPolicyAcceptedAtRaw: null };
  } else {
    res.locals.currentUser = null;
  }
  res.locals.roles = ROLES;
  next();
});

// Every logged-in staff/manager account (everyone except the shared Kiosk/Bot
// account, which isn't a real person) has to acknowledge the current privacy
// notice before doing anything else in the app. If their stored version is
// missing or stale, they get bounced to /accept-privacy. Exempt /logout so a
// pending user can still sign out, and exempt /accept-privacy itself so the
// redirect target doesn't loop back on itself.
app.use((req, res, next) => {
  const u = res.locals.currentUser;
  if (u && u.role !== 'kiosk') {
    const exempt = req.path === '/accept-privacy' || req.path === '/logout';
    if (!exempt && u.privacyPolicyVersionRaw !== STAFF_PRIVACY_VERSION) {
      return res.redirect('/accept-privacy?returnTo=' + encodeURIComponent(req.originalUrl));
    }
  }
  next();
});

// The Kiosk/Bot account is locked to Dashboard + Kiosk only — if it's ever
// pointed at any other URL (typed by hand, a stale bookmark, etc.) it gets
// bounced straight back to the Kiosk. This is what keeps the tablet mounted
// in the restaurant from ever exposing the rest of the admin app. Nobody
// else — not admin, not managers, not Bar/Kitchen Staff — can open /kiosk
// directly; everyone still clocks in the normal way, tapping their tile on
// the shared tablet while the Bot account is the one signed in.
app.use((req, res, next) => {
  const u = res.locals.currentUser;
  if (u && u.role === 'kiosk') {
    const allowed = req.path === '/' || req.path.startsWith('/kiosk') || req.path === '/logout';
    if (!allowed) return res.redirect('/kiosk');
  }
  next();
});

// Kitchen Staff get a deliberately narrow slice of the app — Dashboard,
// My Shifts (incl. the team week-at-a-glance), Requests, Reports, and their
// own Profile. Everything else (Bookings, Tables, Menu, Calendar, Staff
// Status, the Kiosk page, etc.) bounces back to the Dashboard. Like
// everyone else, they clock in/out by tapping their tile on the shared
// kiosk tablet — not by opening /kiosk under their own login.
// Bar Staff keep the full staff-level access they've always had — this
// only applies to the kitchen_staff role.
const KITCHEN_STAFF_ALLOWED_PATHS = ['/my-shifts', '/requests', '/reports', '/profile', '/accept-privacy', '/logs', '/training'];
app.use((req, res, next) => {
  const u = res.locals.currentUser;
  if (u && u.role === 'kitchen_staff') {
    const allowed = req.path === '/' || req.path === '/logout' || KITCHEN_STAFF_ALLOWED_PATHS.some(p => req.path.startsWith(p));
    if (!allowed) return res.redirect('/');
  }
  next();
});

app.use('/', require('./routes/auth'));

// Public, unauthenticated pages — linked from the real website
// (holycrosswaterford.ie). Never gated behind requireAuth.
app.use('/book', require('./routes/publicBooking'));
app.use('/our-menu', require('./routes/publicMenu'));
app.use('/privacy', require('./routes/publicPrivacy'));

app.use('/', requireAuth, require('./routes/privacy'));
app.use('/profile', requireAuth, require('./routes/profile'));
app.use('/', requireAuth, require('./routes/dashboard'));
app.use('/bookings', requireAuth, require('./routes/bookings'));
app.use('/tables', requireAuth, require('./routes/tables'));
app.use('/menu', requireAuth, require('./routes/menu'));
app.use('/calendar', requireAuth, require('./routes/calendar'));
app.use('/notifications', requireAuth, requireNotificationsAccess, require('./routes/notifications'));
app.use('/settings', requireAuth, requireAdmin, require('./routes/settings'));
app.use('/users', requireAuth, requireAdmin, require('./routes/users'));
app.use('/kiosk', requireAuth, requireKioskPageAccess, require('./routes/kiosk'));
app.use('/staff-status', requireAuth, require('./routes/staffStatus'));
app.use('/timesheets', requireAuth, requireTimesheetAccess, require('./routes/timesheets'));
app.use('/roster', requireAuth, requireRosterAccess, require('./routes/roster'));
app.use('/my-shifts', requireAuth, require('./routes/myShifts'));
app.use('/requests', requireAuth, requireRequestsAccess, require('./routes/requests'));
app.use('/duties', requireAuth, requireDutiesAccess, require('./routes/duties'));
app.use('/reports', requireAuth, requireReportAccess, require('./routes/reports'));
app.use('/training', requireAuth, requireTrainingAccess, require('./routes/training'));
app.use('/cash-safe', requireAuth, requireCashSafeAccess, require('./routes/cashSafe'));
app.use('/logs', requireAuth, requireLogsAccess, require('./routes/logs'));

app.use((req, res) => {
  res.status(404).render('404');
});

// Startup sequence is now async (bootstrapAdmin queries CockroachDB) — the
// server can't safely start accepting requests until the initial admin
// account is confirmed to exist, so app.listen waits for it instead of
// running inline at module load like the old JSON-file version did.
async function startServer() {
  await bootstrapAdmin();
  // One-time seed of starter kitchen Training & Resources content (recipes,
  // prep process, cleaning technique) so that section isn't empty the first
  // time Kitchen Staff open it. Idempotent — see seedKitchenStarterContent's
  // own comment for why this is safe to call on every boot. Still JSON-file
  // backed (training hasn't been converted to SQL yet), stays synchronous.
  models.seedKitchenTrainingStarterContent();

  app.listen(PORT, () => {
    console.log(`Bar & Restaurant Booking admin running at http://localhost:${PORT}`);
    notify.startScheduler();
    googleCalendar.startSync(models);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
