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
  const autoRoles = ['admin', 'senior_manager', 'general_manager', 'floor_manager', 'staff'];
  if (u && (autoRoles.includes(u.role) || u.canMakeRequests)) return next();
  return res.status(403).render('403');
}

module.exports = { requireAuth, requireAdmin, requireTimesheetAccess, requireRosterAccess, requireRequestsAccess };
