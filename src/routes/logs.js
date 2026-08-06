// Logs — a single read-only page pulling together every activity trail in
// the app (clock in/out, duties, staff reports, requests, booking history,
// and the email/SMS notification log) so a manager can monitor everything
// in one place instead of hopping between pages. Mounted behind
// requireLogsAccess in server.js: every manager-tier role (see
// MANAGER_ROLES in src/roles.js) plus Admin get in automatically; a Bar/
// Kitchen Staff member only sees this if a manager individually switches it
// on for them from the Users page (models.setUserLogsAccess). This route
// itself does no further gating — requireLogsAccess is the only check.
const express = require('express');
const router = express.Router();
const models = require('../models');

// Caps keep the page fast once the JSON "database" has months of history —
// each section is already sorted newest-first by its model function, so a
// slice is just "the most recent N", not an arbitrary sample.
const SECTION_LIMIT = 200;

router.get('/', (req, res) => {
  res.render('logs', {
    clockEntries: models.listClockEntries().slice(0, SECTION_LIMIT),
    dutyReports: models.listAllDutyReports().slice(0, SECTION_LIMIT),
    reports: models.listAllReports().slice(0, SECTION_LIMIT),
    requests: models.listAllRequests().slice(0, SECTION_LIMIT),
    bookingHistory: models.listBookingHistory().slice(0, SECTION_LIMIT),
    notifications: models.listNotifications(SECTION_LIMIT)
  });
});

module.exports = router;
