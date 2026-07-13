const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', (req, res) => {
  res.render('settings', { settings: models.getSettings() });
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

module.exports = router;
