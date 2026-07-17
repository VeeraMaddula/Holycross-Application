const express = require('express');
const router = express.Router();
const models = require('../models');
const googleCalendar = require('../googleCalendar');
const { hashPassword } = require('../password');

router.get('/', (req, res) => {
  res.render('settings', {
    settings: models.getSettings(),
    googleConfigured: googleCalendar.isConfigured(),
    googleCalendarId: googleCalendar.isConfigured() ? googleCalendar.calendarId() : null,
    googleSyncStatus: models.getGoogleSyncStatus(),
    cleared: req.query.cleared === '1'
  });
});

router.post('/', (req, res) => {
  const { slotDurationMinutes, reminderHoursBefore, openHour, closeHour } = req.body;
  models.saveSettings({
    slotDurationMinutes: Number(slotDurationMinutes),
    reminderHoursBefore: Number(reminderHoursBefore),
    openHour: Number(openHour),
    closeHour: Number(closeHour)
  });
  res.redirect('/settings');
});

// Danger zone — wipes bookings/notifications/timesheets/roster/requests but
// keeps user accounts, tables, the menu, and settings. Admin-only (this
// whole router is mounted behind requireAdmin in server.js).
router.post('/clear-data', (req, res) => {
  models.clearOperationalData();
  res.redirect('/settings?cleared=1');
});

// Danger zone — wipes EVERYTHING (including every user account) back to
// the app's defaults, then recreates a single fresh admin from the
// ADMIN_EMAIL/ADMIN_PASSWORD in .env. Since the account performing this
// action may no longer exist afterwards, always end the session and send
// them back to login with the freshly (re)created admin credentials.
router.post('/factory-reset', (req, res) => {
  const email = (process.env.ADMIN_EMAIL || 'admin@holycross.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  models.factoryReset(email, hashPassword(password));
  req.session.destroy(() => res.redirect('/login'));
});

router.post('/google-sync-now', async (req, res) => {
  if (googleCalendar.isConfigured()) {
    try {
      const events = await googleCalendar.listExternalEvents();
      models.replaceExternalCalendarEvents(events);
    } catch (err) {
      console.warn('Google Calendar manual sync failed:', err.message);
    }
  }
  res.redirect('/settings');
});

module.exports = router;
