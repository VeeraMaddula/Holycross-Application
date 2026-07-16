require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { ensureDb } = require('./db');
const models = require('./models');
const { hashPassword } = require('./password');
const { requireAuth, requireAdmin, requireTimesheetAccess, requireRosterAccess, requireRequestsAccess, requireNotificationsAccess, requireKioskPageAccess } = require('./middleware');
const { ROLES, ROLE_LABELS } = require('./roles');
const notify = require('./notify');
const googleCalendar = require('./googleCalendar');

ensureDb();

// Bootstrap an initial admin account on first run, from .env credentials.
function bootstrapAdmin() {
  if (models.listUsers().length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@holycross.local').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'changeme123';
    models.createUser({ name: 'Admin', email, passwordHash: hashPassword(password), role: 'admin' });
    console.log(`Created initial admin user "${email}" using ADMIN_EMAIL / ADMIN_PASSWORD from .env`);
  }
}
bootstrapAdmin();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-please',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 } // 12 hours
}));

// Make current path + logged-in user available to all views.
// Looks the user up fresh from the DB each request (not just the session) so
// avatar/role changes show up immediately without needing to log out and back in.
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.isAuthed = !!(req.session && req.session.userId);
  if (req.session && req.session.userId) {
    const dbUser = models.getUserById(req.session.userId);
    res.locals.currentUser = dbUser
      ? {
          id: dbUser.id,
          name: dbUser.name,
          firstName: (dbUser.name || '').trim().split(/\s+/)[0] || dbUser.name,
          role: dbUser.role,
          roleLabel: ROLE_LABELS[dbUser.role] || dbUser.role,
          avatarPath: dbUser.avatarPath || '',
          canViewTimesheets: !!dbUser.canViewTimesheets,
          canManageRoster: !!dbUser.canManageRoster,
          canMakeRequests: !!dbUser.canMakeRequests,
          canBookFunctions: !!dbUser.canBookFunctions,
          canViewNotifications: !!dbUser.canViewNotifications
        }
      : { name: req.session.name, firstName: req.session.name, role: req.session.role, roleLabel: ROLE_LABELS[req.session.role] || req.session.role, avatarPath: '', canViewTimesheets: false, canManageRoster: false, canMakeRequests: false, canBookFunctions: false, canViewNotifications: false };
  } else {
    res.locals.currentUser = null;
  }
  res.locals.roles = ROLES;
  next();
});

// The Kiosk/Bot account is locked to the /kiosk page only — if it's ever
// pointed at any other URL (typed by hand, a stale bookmark, etc.) it gets
// bounced straight back. This is what keeps the tablet mounted in the
// restaurant from ever exposing the rest of the admin app.
app.use((req, res, next) => {
  const u = res.locals.currentUser;
  if (u && u.role === 'kiosk' && !req.path.startsWith('/kiosk') && req.path !== '/logout') {
    return res.redirect('/kiosk');
  }
  next();
});

app.use('/', require('./routes/auth'));

app.use('/profile', requireAuth, require('./routes/profile'));
app.use('/', requireAuth, require('./routes/dashboard'));
app.use('/bookings', requireAuth, require('./routes/bookings'));
app.use('/tables', requireAuth, require('./routes/tables'));
app.use('/menu', requireAuth, require('./routes/menu'));
app.use('/calendar', requireAuth, require('./routes/calendar'));
app.use('/notifications', requireAuth, requireNotificationsAccess, require('./routes/notifications'));
app.use('/settings', requireAuth, requireAdmin, require('./routes/settings'));
app.use('/users', requireAuth, requireAdmin, require('./routes/users'));
app.use('/clock', requireAuth, require('./routes/clock'));
app.use('/kiosk', requireAuth, requireKioskPageAccess, require('./routes/kiosk'));
app.use('/staff-status', requireAuth, require('./routes/staffStatus'));
app.use('/timesheets', requireAuth, requireTimesheetAccess, require('./routes/timesheets'));
app.use('/roster', requireAuth, requireRosterAccess, require('./routes/roster'));
app.use('/my-shifts', requireAuth, require('./routes/myShifts'));
app.use('/requests', requireAuth, requireRequestsAccess, require('./routes/requests'));

app.use((req, res) => {
  res.status(404).render('404');
});

app.listen(PORT, () => {
  console.log(`Bar & Restaurant Booking admin running at http://localhost:${PORT}`);
  notify.startScheduler();
  googleCalendar.startSync(models);
});
