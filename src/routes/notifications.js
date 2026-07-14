const express = require('express');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const sms = require('../sms');

router.get('/', (req, res) => {
  const emailConfigured = !!notify.getTransporter();
  const smsConfigured = sms.isConfigured();
  res.render('notifications', { notifications: models.listNotifications(), emailConfigured, smsConfigured });
});

router.post('/run-reminder-sweep', async (req, res) => {
  await notify.runReminderSweep();
  res.redirect('/notifications');
});

module.exports = router;
