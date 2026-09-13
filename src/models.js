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
const dutyTasks = require('./models/dutyTasks');
const shiftDrops = require('./models/shiftDrops');
const requests = require('./models/requests');
const staffReports = require('./models/staffReports');
const trainingResources = require('./models/trainingResources');
const selfVerification = require('./models/selfVerification');
const admin = require('./models/admin');
const vouchers = require('./models/vouchers');
const breakage = require('./models/breakage');
const design = require('./models/design');
const { toMinutes, bookingRange, minutesToHHMM } = require('./models/shared');
const { todayStr } = require('./dateUtils');

// Live occupancy for the Tables page: for each table, checks today's
// non-cancelled bookings against the current time. A table is "occupied"
// if right now falls inside a booking's start-to-start+duration window,
// "reserved" if nothing's active now but something's coming up later
// today, otherwise "available". Composed here rather than in tables.js or
// bookings.js because it needs both — tables.js can't require bookings.js
// (bookings.js already requires tables.js for getTableById, and this
// codebase's `module.exports = {...}` pattern breaks under a circular
// require — see tables.js's own comment on this).
async function getTablesWithStatus() {
  const [allTables, allBookings, settingsData] = await Promise.all([tables.listTables(), bookings.listBookings(), settings.getSettings()]);
  const today = todayStr();
  const slotDuration = settingsData.slotDurationMinutes;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const todaysByTable = new Map();
  allBookings.forEach(b => {
    if (b.date !== today || b.status === 'cancelled') return;
    const key = String(b.tableId);
    if (!todaysByTable.has(key)) todaysByTable.set(key, []);
    todaysByTable.get(key).push(b);
  });

  return allTables.map(t => {
    const todaysBookings = (todaysByTable.get(String(t.id)) || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    const current = todaysBookings.find(b => {
      const r = bookingRange(b, slotDuration);
      return nowMinutes >= r.start && nowMinutes < r.end;
    });
    if (current) {
      const r = bookingRange(current, slotDuration);
      return {
        ...t,
        status: 'occupied',
        statusLabel: `Occupied · ${current.time}–${minutesToHHMM(r.end)}`,
        booking: current
      };
    }
    const upcoming = todaysBookings.find(b => bookingRange(b, slotDuration).start > nowMinutes);
    if (upcoming) {
      return { ...t, status: 'reserved', statusLabel: `Reserved · ${upcoming.time}`, booking: upcoming };
    }
    return { ...t, status: 'available', statusLabel: 'Available', booking: null };
  });
}

module.exports = {
  // Admin danger-zone (Settings page)
  clearOperationalData: admin.clearOperationalData,
  factoryReset: admin.factoryReset,

  // Tables
  listTables: tables.listTables,
  getTablesWithStatus,
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
  setUserDutiesEditAccess: users.setUserDutiesEditAccess,
  setUserTrainingEditAccess: users.setUserTrainingEditAccess,
  setUserVoucherAccess: users.setUserVoucherAccess,
  setUserBreakageAccess: users.setUserBreakageAccess,
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
  getWeeklyHoursForUser: clockEntries.getWeeklyHoursForUser,

  // Roster
  ROSTER_AREAS: roster.AREAS,
  ROSTER_AREA_LABELS: roster.AREA_LABELS,
  listRosterShiftsForRange: roster.listRosterShiftsForRange,
  addRosterShift: roster.addRosterShift,
  updateRosterShift: roster.updateRosterShift,
  removeRosterShift: roster.removeRosterShift,
  getResolvedScheduleForRange: roster.getResolvedScheduleForRange,
  getUserUpcomingShifts: roster.getUserUpcomingShifts,
  getPendingNotificationsForRange: roster.getPendingNotificationsForRange,
  markShiftsNotifiedForRange: roster.markShiftsNotifiedForRange,
  removeOrphanedShifts: roster.removeOrphanedShifts,

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

  // Bar Staff Duties task definitions (add/edit/remove tasks)
  getDutySections: dutyTasks.getDutySections,
  addDutyTask: dutyTasks.addDutyTask,
  updateDutyTask: dutyTasks.updateDutyTask,
  deleteDutyTask: dutyTasks.deleteDutyTask,

  // Shift Marketplace (drop / pick up / exchange roster shifts)
  listOpenDrops: shiftDrops.listOpenDrops,
  getDrop: shiftDrops.getDrop,
  dropShift: shiftDrops.dropShift,
  cancelDrop: shiftDrops.cancelDrop,
  pickUpDrop: shiftDrops.pickUpDrop,
  exchangeDrop: shiftDrops.exchangeDrop,

  // Staff Reports ("Report an Issue")
  REPORT_CATEGORIES: staffReports.REPORT_CATEGORIES,
  createReport: staffReports.createReport,
  listReportsForUser: staffReports.listReportsForUser,
  getReport: staffReports.getReport,
  markReportReviewed: staffReports.markReportReviewed,
  listAllReports: staffReports.listAllReports,

  // Training & Resources (Behind the Bar: cocktail/spirit/beer; In the
  // Kitchen: recipe/prep/cleaning — see visibleSections for the per-role
  // split between the two)
  TRAINING_CATEGORIES: trainingResources.CATEGORIES,
  TRAINING_CATEGORY_LABELS: trainingResources.CATEGORY_LABELS,
  TRAINING_FIELD_LABELS: trainingResources.FIELD_LABELS,
  TRAINING_SECTIONS: trainingResources.SECTIONS,
  visibleTrainingSections: trainingResources.visibleSections,
  listTrainingItems: trainingResources.listItems,
  listTrainingItemsByCategory: trainingResources.listItemsByCategory,
  getTrainingItem: trainingResources.getItem,
  createTrainingItem: trainingResources.createItem,
  updateTrainingItem: trainingResources.updateItem,
  setTrainingItemMedia: trainingResources.setItemMedia,
  deleteTrainingItem: trainingResources.deleteItem,
  seedKitchenTrainingStarterContent: trainingResources.seedKitchenStarterContent,

  // Self-service verification codes (Profile page: change password / PIN)
  requestVerificationCode: selfVerification.requestVerificationCode,
  confirmPasswordChange: selfVerification.confirmPasswordChange,
  confirmPinChange: selfVerification.confirmPinChange,

  // Vouchers
  listVouchers: vouchers.listVouchers,
  getVoucherById: vouchers.getVoucherById,
  getVoucherByNumber: vouchers.getVoucherByNumber,
  sellVoucher: vouchers.sellVoucher,
  listRedemptionsForVoucher: vouchers.listRedemptionsForVoucher,
  redeemVoucher: vouchers.redeemVoucher,
  voidVoucher: vouchers.voidVoucher,
  listVouchersSoldBetween: vouchers.listVouchersSoldBetween,
  listRedemptionsBetween: vouchers.listRedemptionsBetween,

  // Breakage / stock-shortage reports
  BREAKAGE_CATEGORIES: breakage.BREAKAGE_CATEGORIES,
  BREAKAGE_CATEGORY_VALUES: breakage.BREAKAGE_CATEGORY_VALUES,
  BREAKAGE_CATEGORY_LABELS: breakage.BREAKAGE_CATEGORY_LABELS,
  listBreakageReports: breakage.listBreakageReports,
  listBreakageReportsByUser: breakage.listBreakageReportsByUser,
  addBreakageReport: breakage.addBreakageReport,
  getBreakageCountsByUser: breakage.getBreakageCountsByUser,

  // Design Studio (AI image/video generation history via OpenArt)
  listGenerations: design.listGenerations,
  getGeneration: design.getGeneration,
  createGeneration: design.createGeneration,
  markGenerationComplete: design.markGenerationComplete,
  markGenerationFailed: design.markGenerationFailed,

  // Shared helper (used by a couple of route files directly)
  toMinutes
};
