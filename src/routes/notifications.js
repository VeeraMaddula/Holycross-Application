const express = require('express');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');

router.get('/', (req, res) => {
  const emailConfigured = !!notify.getTransporter();
  res.render('notifications', { notifications: models.listNotifications(), emailConfigured });
});

router.post('/run-reminder-sweep', async (req, res) => {
  await notify.runReminderSweep();
  res.redirect('/notifications');
});

module.exports = router;
