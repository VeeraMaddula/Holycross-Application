const express = require('express');
const router = express.Router();
const models = require('../models');
const googleCalendar = require('../googleCalendar');

router.get('/', (req, res) => {
  res.render('settings', {
    settings: models.getSettings(),
    googleConfigured: googleCalendar.isConfigured(),
    googleCalendarId: googleCalendar.isConfigured() ? googleCalendar.calendarId() : null,
    googleSyncStatus: models.getGoogleSyncStatus()
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
