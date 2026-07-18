// Bar Staff and Kitchen Staff — both get Requests access automatically.
// (Page access otherwise differs between them; see server.js for Kitchen
// Staff's narrower allow-list.)
const STAFF_ROLES = ['bar_staff', 'kitchen_staff'];

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).render('403');
}

// Timesheet access (view + CSV download) = Admin, Senior Manager, Floor
// Manager, or anyone individually granted access via the Users page
// (res.locals.currentUser is refreshed from the DB on every request, so
// this reflects role/grant changes immediately). Editing/adding/deleting
// individual clock entries is narrower — see requireTimesheetEditAccess.
function requireTimesheetAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (u.role === 'admin' || u.role === 'senior_manager' || u.role === 'floor_manager' || u.canViewTimesheets)) return next();
  return res.status(403).render('403');
}

// Correcting clock-in/out times (staff forgot to tap in/out) = Admin and
// Senior Manager only — deliberately narrower than view/download access.
function requireTimesheetEditAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (u.role === 'admin' || u.role === 'senior_manager')) return next();
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

// Kiosk page access = the Kiosk/Bot account, plus Admin and Senior Manager
// (so they can preview/test the tablet screen without logging out of their
// own account into Bot). Everyone else — Bar/Kitchen Staff, Floor/General/
// Staff Manager — still only ever sees this by tapping their photo tile on
// the shared tablet while the Bot account is the one signed in.
function requireKioskPageAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (u.role === 'kiosk' || u.role === 'admin' || u.role === 'senior_manager')) return next();
  return res.status(403).render('403');
}

// Duties checklist access = Bar Staff (it's their sheet), plus Admin and
// Senior Manager so they can check in on it / preview it, same reasoning as
// requireKioskPageAccess above. Kitchen Staff and everyone else don't see it.
function requireDutiesAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (u.role === 'bar_staff' || u.role === 'admin' || u.role === 'senior_manager')) return next();
  return res.status(403).render('403');
}

// Report access = everyone with a real staff account — the whole point is
// "any staff can report anything." Only the Kiosk/Bot account (which isn't
// a person) is excluded.
function requireReportAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && u.role !== 'kiosk') return next();
  return res.status(403).render('403');
}

module.exports = { requireAuth, requireAdmin, requireTimesheetAccess, requireTimesheetEditAccess, requireRosterAccess, requireRequestsAccess, requireNotificationsAccess, requireKioskPageAccess, requireDutiesAccess, requireReportAccess, STAFF_ROLES };
