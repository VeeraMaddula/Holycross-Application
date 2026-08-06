// This file is a barrel: the single, stable entry point every route file
// requires (`require('./models')` / `require('../models')`), re-exporting
// the real implementations from the small, single-purpose files under
// ./models/. Nothing outside this file (routes, tests) needs to know the
// business logic lives in separate files per domain — that split is purely
// internal organization.
//
// Why split it up: this used to be one 1,400-line file covering every
// domain in the app (bookings, users, roster, cash safe, duties, and
// more) — functional, but hard for a new engineer to find anything in, and
// every unrelated change touched the same file. Now each domain has its
// own file under ./models/, named for what it covers, and this barrel just
// re-exports their public functions unchanged. See ARCHITECTURE.md for the
// full map of what lives where.
//
// A couple of submodules depend on each other directly (e.g. clockEntries
// needs users.listUsers, dutyChecklist needs clockEntries.listAllStaffStatus)
// — they require each other by relative path within ./models/, never
// through this barrel, so there's no circular-require risk.
const tables = require('./models/tables');
const bookings = require('./models/bookings');
const menu = require('./models/menu');
const notificationsLog = require('./models/notificationsLog');
const settings = require('./models/settings');
const users = require('./models/users');
const passwordReset = require('./models/passwordReset');
const cashSafe = require('./models/cashSafe');
const calendarSync = require('./models/calendarSync');
const clockEntries = require('./models/clockEntries');
const roster = require('./models/roster');
const dutyChecklist = require('./models/dutyChecklist');
const requests = require('./models/requests');
const staffReports = require('./models/staffReports');
const admin = require('./models/admin');
const { toMinutes } = require('./models/shared');

module.exports = {
  // Admin danger-zone (Settings page)
  clearOperationalData: admin.clearOperationalData,
  factoryReset: admin.factoryReset,

  // Tables
  listTables: tables.listTables,
  getTablesWithStatus: tables.getTablesWithStatus,
  createTable: tables.createTable,
  deleteTable: tables.deleteTable,

  // Bookings
  listBookings: bookings.listBookings,
  getBooking: bookings.getBooking,
  createBooking: bookings.createBooking,
  findBestAvailableTable: bookings.findBestAvailableTable,
  approveBooking: bookings.approveBooking,
  updateBooking: bookings.updateBooking,
  setStatus: bookings.setStatus,
  updatePayment: bookings.updatePayment,
  deleteBooking: bookings.deleteBooking,
  listBookingHistory: bookings.listBookingHistory,

  // Menu / events
  getMenu: menu.getMenu,
  saveMenu: menu.saveMenu,
  listEvents: menu.listEvents,
  createEvent: menu.createEvent,
  deleteEvent: menu.deleteEvent,

  // Notifications log
  logNotification: notificationsLog.logNotification,
  listNotifications: notificationsLog.listNotifications,
  getNotification: notificationsLog.getNotification,

  // Settings
  getSettings: settings.getSettings,
  saveSettings: settings.saveSettings,

  // Users
  listUsers: users.listUsers,
  getUserByEmail: users.getUserByEmail,
  getUserByUsername: users.getUserByUsername,
  getUserByPhone: users.getUserByPhone,
  getUserByLoginIdentifier: users.getUserByLoginIdentifier,
  getUserById: users.getUserById,
  createUser: users.createUser,
  updateUserProfile: users.updateUserProfile,
  setUserActive: users.setUserActive,
  setUserRole: users.setUserRole,
  setUserAvatar: users.setUserAvatar,
  setUserTimesheetAccess: users.setUserTimesheetAccess,
  setUserRosterAccess: users.setUserRosterAccess,
  setUserRequestsAccess: users.setUserRequestsAccess,
  setUserFunctionBookingAccess: users.setUserFunctionBookingAccess,
  setUserNotificationsAccess: users.setUserNotificationsAccess,
  setUserCashSafeAccess: users.setUserCashSafeAccess,
  setUserLogsAccess: users.setUserLogsAccess,
  setUserColor: users.setUserColor,
  acceptPrivacyPolicy: users.acceptPrivacyPolicy,

  // Cash Safe
  SAFE_STARTING_BALANCE: cashSafe.SAFE_STARTING_BALANCE,
  listCashLogs: cashSafe.listCashLogs,
  getCurrentSafeBalance: cashSafe.getCurrentSafeBalance,
  addCashLog: cashSafe.addCashLog,
  getCashSafeLodgementTarget: cashSafe.getCashSafeLodgementTarget,
  setCashSafeLodgementTarget: cashSafe.setCashSafeLodgementTarget,
  getCashLodgementHistory: cashSafe.getCashLodgementHistory,

  // Forgot password
  createPasswordResetToken: passwordReset.createPasswordResetToken,
  getUserByResetToken: passwordReset.getUserByResetToken,
  resetPasswordWithToken: passwordReset.resetPasswordWithToken,

  // Google Calendar sync bookkeeping
  setBookingGoogleEventId: calendarSync.setBookingGoogleEventId,
  listExternalCalendarEvents: calendarSync.listExternalCalendarEvents,
  replaceExternalCalendarEvents: calendarSync.replaceExternalCalendarEvents,
  getGoogleSyncStatus: calendarSync.getGoogleSyncStatus,

  // Staff clock in/out + kiosk PIN
  getLatestClockEntry: clockEntries.getLatestClockEntry,
  getStaffStatus: clockEntries.getStaffStatus,
  nextValidAction: clockEntries.nextValidAction,
  listAllStaffStatus: clockEntries.listAllStaffStatus,
  addClockEntry: clockEntries.addClockEntry,
  listClockEntries: clockEntries.listClockEntries,
  getClockEntry: clockEntries.getClockEntry,
  addManualClockEntry: clockEntries.addManualClockEntry,
  updateClockEntry: clockEntries.updateClockEntry,
  deleteClockEntry: clockEntries.deleteClockEntry,
  setUserPin: clockEntries.setUserPin,
  verifyUserPin: clockEntries.verifyUserPin,
  getKioskRoster: clockEntries.getKioskRoster,
  setUserLiveShiftAvatar: clockEntries.setUserLiveShiftAvatar,

  // Roster
  listRosterShiftsForRange: roster.listRosterShiftsForRange,
  addRosterShift: roster.addRosterShift,
  updateRosterShift: roster.updateRosterShift,
  removeRosterShift: roster.removeRosterShift,
  getResolvedScheduleForRange: roster.getResolvedScheduleForRange,
  getUserUpcomingShifts: roster.getUserUpcomingShifts,

  // Requests
  REQUEST_TYPES: requests.REQUEST_TYPES,
  createRequest: requests.createRequest,
  listRequestsForUser: requests.listRequestsForUser,
  listAllRequests: requests.listAllRequests,

  // Bar Staff Duties checklist
  getDutiesChecklist: dutyChecklist.getDutiesChecklist,
  toggleDutyTask: dutyChecklist.toggleDutyTask,
  getDutyPanelState: dutyChecklist.getDutyPanelState,
  recordDutyReport: dutyChecklist.recordDutyReport,
  getDutyReport: dutyChecklist.getDutyReport,
  getBarStaffOnShiftNames: dutyChecklist.getBarStaffOnShiftNames,
  listAllDutyReports: dutyChecklist.listAllDutyReports,

  // Staff Reports ("Report an Issue")
  REPORT_CATEGORIES: staffReports.REPORT_CATEGORIES,
  createReport: staffReports.createReport,
  listReportsForUser: staffReports.listReportsForUser,
  getReport: staffReports.getReport,
  markReportReviewed: staffReports.markReportReviewed,
  listAllReports: staffReports.listAllReports,

  // Shared helper (used by a couple of route files directly)
  toMinutes
};
