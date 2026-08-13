const { MANAGER_ROLES } = require('./roles');

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

// Duties checklist access = Bar Staff (it's their sheet), plus every
// manager-tier role (Admin, Senior/General/Floor Manager, Staff Manager —
// see MANAGER_ROLES in src/roles.js) so they can check in on it, preview
// it, and — for the ones with duties-edit access — edit the task list
// itself (see requireDutiesEditAccess below). Kitchen Staff and everyone
// else still don't see it. This used to be Admin/Senior Manager only;
// widened so every manager can actually reach the Edit duties button.
function requireDutiesAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (u.role === 'bar_staff' || MANAGER_ROLES.includes(u.role) || u.canEditDuties)) return next();
  return res.status(403).render('403');
}

// Editing the duties TASK LIST (adding/renaming/removing tasks, not just
// ticking them off day-to-day) = every manager-tier role automatically,
// plus anyone individually granted it via the Users page — same pattern as
// requireCashSafeAccess/requireLogsAccess above. Bar/Kitchen Staff never
// get this unless a manager explicitly switches it on for them.
function requireDutiesEditAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (MANAGER_ROLES.includes(u.role) || u.canEditDuties)) return next();
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

// Cash Safe Log access = Admin, Senior Manager, General Manager, Floor
// Manager automatically, plus anyone individually granted access via the
// Users page (used to give specific Bar Staff access) — same pattern as
// requireTimesheetAccess/requireRosterAccess above.
function requireCashSafeAccess(req, res, next) {
  const u = res.locals.currentUser;
  const autoRoles = ['admin', 'senior_manager', 'general_manager', 'floor_manager'];
  if (u && (autoRoles.includes(u.role) || u.canManageCashSafe)) return next();
  return res.status(403).render('403');
}

// Logs page access = every manager-tier role (Admin, Senior/General/Floor
// Manager, Staff Manager — see MANAGER_ROLES in src/roles.js) automatically,
// plus anyone individually granted access via the Users page — same pattern
// as requireCashSafeAccess above. Bar/Kitchen Staff and the Kiosk/Bot
// account never see this unless a manager explicitly switches it on for
// them. This page shows clock in/out, duties, report, request, and booking
// history in one place, including staff photos — deliberately not staff-
// visible by default.
function requireLogsAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (MANAGER_ROLES.includes(u.role) || u.canViewLogs)) return next();
  return res.status(403).render('403');
}

// Training & Resources (view) = every real staff account — the whole point
// is any Bar/Kitchen Staff member can look up a recipe on shift. Only the
// Kiosk/Bot account (not a person) is excluded, same pattern as
// requireReportAccess above.
function requireTrainingAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && u.role !== 'kiosk') return next();
  return res.status(403).render('403');
}

// Training & Resources EDIT (add/edit/delete recipes, upload photos/videos,
// paste YouTube links) = every manager-tier role automatically, plus anyone
// individually granted it via the Users page — same pattern as
// requireCashSafeAccess/requireDutiesEditAccess above.
function requireTrainingEditAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (MANAGER_ROLES.includes(u.role) || u.canEditTraining)) return next();
  return res.status(403).render('403');
}

// Marketing / Design requests page = every manager-tier role automatically
// (Admin, Senior/General/Floor Manager, Staff Manager — see MANAGER_ROLES in
// src/roles.js), plus anyone individually granted it via the Users page —
// same pattern as requireCashSafeAccess/requireLogsAccess above. Bar/Kitchen
// Staff and the Kiosk/Bot account don't see this.
function requireMarketingAccess(req, res, next) {
  const u = res.locals.currentUser;
  if (u && (MANAGER_ROLES.includes(u.role) || u.canManageMarketing)) return next();
  return res.status(403).render('403');
}

module.exports = { requireAuth, requireAdmin, requireTimesheetAccess, requireTimesheetEditAccess, requireRosterAccess, requireRequestsAccess, requireNotificationsAccess, requireKioskPageAccess, requireDutiesAccess, requireDutiesEditAccess, requireReportAccess, requireCashSafeAccess, requireLogsAccess, requireTrainingAccess, requireTrainingEditAccess, requireMarketingAccess, STAFF_ROLES };
