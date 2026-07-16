// Both front-line staff types — bar and kitchen — get identical access
// everywhere in the app; the split is just so shifts/rosters can categorize
// who's on bar duty vs kitchen duty. Any check that used to say "role is
// staff" now means "role is one of these".
const STAFF_ROLES = ['bar_staff', 'kitchen_staff'];

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).render('403');
}

// Timesheet access = Admin, Senior Manager, or anyone individually granted
// access via the Users page (res.locals.currentUser is refreshed from the DB
// on every request, so this reflects role/grant changes immediately).
function requireTimesheetAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (u.role === 'admin' || u.role === 'senior_manager' || u.canViewTimesheets)) return next();
  return res.status(403).render('403');
}

// Roster access = Admin, Senior Manager, or anyone individually granted
// access via the Users page (same pattern as requireTimesheetAccess).
function requireRosterAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (u.role === 'admin' || u.role === 'senior_manager' || u.canManageRoster)) return next();
  return res.status(403).render('403');
}

// Requests access = Admin, Senior Manager, General Manager, Floor Manager,
// Staff, or anyone individually granted access via the Users page (covers
// e.g. a Staff Manager who needs it — same pattern as the other gates above).
function requireRequestsAccess(req, res, next) {
  const u = res.locals.currentUser;
  const autoRoles = ['admin', 'senior_manager', 'general_manager', 'floor_manager', ...STAFF_ROLES];
  if (u && (autoRoles.includes(u.role) || u.canMakeRequests)) return next();
  return res.status(403).render('403');
}

// Notifications access = Admin, Senior Manager, or anyone individually
// granted access via the Users page (same pattern as the other gates above).
function requireNotificationsAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (u.role === 'admin' || u.role === 'senior_manager' || u.canViewNotifications)) return next();
  return res.status(403).render('403');
}

// Kiosk page access = everyone except front-line Bar/Kitchen Staff (Admin,
// all manager roles, and the Kiosk/Bot account itself). Staff never open
// this page directly — they only interact with it by tapping their tile
// while the Bot account is the one signed in on the tablet.
function requireKioskPageAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && !STAFF_ROLES.includes(u.role)) return next();
  return res.status(403).render('403');
}

module.exports = { requireAuth, requireAdmin, requireTimesheetAccess, requireRosterAccess, requireRequestsAccess, requireNotificationsAccess, requireKioskPageAccess, STAFF_ROLES };
