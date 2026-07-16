const express = require('express');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const sms = require('../sms');

router.get('/', (req, res) => {
  const emailConfigured = !!notify.getTransporter();
  const smsConfigured = sms.isConfigured();
  res.render('notifications', { notifications: models.listNotifications(), emailConfigured, smsConfigured, retryResult: req.query.retry || null });
});

router.post('/run-reminder-sweep', async (req, res) => {
  await notify.runReminderSweep();
  res.redirect('/notifications');
});

// Resends a previously failed notification. Notifications logged after this
// feature was added carry their full message text, so those retry exactly.
// Older rows (logged before we started storing text) are reconstructed from
// the linked booking where possible; if there's nothing to rebuild from,
// we tell the user rather than silently failing again.
router.post('/:id/retry', async (req, res) => {
  const notification = models.getNotification(req.params.id);
  if (!notification) return res.redirect('/notifications');

  const isSms = notification.type.endsWith('-sms');
  const baseType = isSms ? notification.type.slice(0, -4) : notification.type;

  let text = notification.text;
  let subject = notification.subject;

  if (!text && notification.bookingId && ['confirmation', 'reminder', 'admin-new-booking'].includes(baseType)) {
    const booking = models.getBooking(notification.bookingId);
    if (booking) {
      const table = models.listTables().find(t => t.id === booking.tableId);
      const tableName = table ? table.name : 'your table';
      if (baseType === 'confirmation') {
        const built = isSms
          ? { text: sms.bookingConfirmationSms(booking, tableName) }
          : notify.bookingConfirmationEmail(booking, tableName);
        subject = built.subject; text = built.text;
      } else if (baseType === 'reminder') {
        const built = isSms
          ? { text: sms.bookingReminderSms(booking, tableName) }
          : notify.bookingReminderEmail(booking, tableName);
        subject = built.subject; text = built.text;
      } else if (baseType === 'admin-new-booking') {
        text = `${booking.customerName} (${booking.phone || booking.email}) booked ${tableName} for ${booking.partySize} on ${booking.date} at ${booking.time}.`;
      }
    }
  }

  if (!text) {
    return res.redirect('/notifications?retry=unavailable');
  }

  if (isSms) {
    await sms.sendSms({ to: notification.recipient, body: text, type: baseType, bookingId: notification.bookingId });
  } else {
    await notify.sendEmail({ to: notification.recipient, subject, text, type: baseType, bookingId: notification.bookingId });
  }

  res.redirect('/notifications?retry=sent');
});

module.exports = router;
