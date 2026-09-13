const express = require('express');
const router = express.Router();
const models = require('../models');
const googleCalendar = require('../googleCalendar');
const { hashPassword } = require('../password');
const notify = require('../notify');

router.get('/', async (req, res) => {
  const [settings, googleSyncStatus] = await Promise.all([models.getSettings(), models.getGoogleSyncStatus()]);
  res.render('settings', {
    settings,
    googleConfigured: googleCalendar.isConfigured(),
    googleCalendarId: googleCalendar.isConfigured() ? googleCalendar.calendarId() : null,
    googleSyncStatus,
    cleared: req.query.cleared === '1'
  });
});

router.post('/', async (req, res) => {
  const { slotDurationMinutes, reminderHoursBefore, openHour, closeHour } = req.body;
  await models.saveSettings({
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
router.post('/clear-data', async (req, res) => {
  await models.clearOperationalData();
  res.redirect('/settings?cleared=1');
});

// Danger zone — wipes EVERYTHING (including every user account) back to
// the app's defaults, then recreates a single fresh admin from the
// ADMIN_EMAIL/ADMIN_PASSWORD in .env. Since the account performing this
// action may no longer exist afterwards, always end the session and send
// them back to login with the freshly (re)created admin credentials.
router.post('/factory-reset', async (req, res) => {
  const email = (process.env.ADMIN_EMAIL || 'admin@holycross.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  const byName = req.session.name || 'an admin';
  await models.factoryReset(email, hashPassword(password));
  // Best-effort — the reset itself has already fully succeeded at this
  // point, so a notification failure (bad SMTP config, no recipients on
  // file, etc.) must never turn a successful reset back into an error page.
  notify.notifyAdminAndSeniorManagersFactoryReset(byName)
    .catch(err => console.warn('Factory reset notification email failed:', err.message));
  req.session.destroy(() => res.redirect('/login?factoryReset=1'));
});

router.post('/google-sync-now', async (req, res) => {
  if (googleCalendar.isConfigured()) {
    try {
      const events = await googleCalendar.listExternalEvents();
      await models.replaceExternalCalendarEvents(events);
    } catch (err) {
      console.warn('Google Calendar manual sync failed:', err.message);
    }
  }
  res.redirect('/settings');
});

module.exports = router;
