const express = require('express');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const sms = require('../sms');
const { todayStr } = require('../dateUtils');
const { publicBookingLimiter } = require('../rateLimiters');

// Public "Reserve a table" page — no login required, meant to be linked
// from the real website (holycrosswaterford.ie). Deliberately a small
// subset of the internal booking form: no table picker, no music/food
// packages — just what a customer filling this out themselves would
// reasonably know. Every submission is parked as pending_approval (see
// models.createBooking's forcePendingApproval option) so a Manager always
// reviews it before the customer is told it's confirmed.
router.get('/', async (req, res) => {
  const settings = await models.getSettings();
  res.render('public/book', { settings, today: todayStr(), error: null, values: {} });
});

router.post('/', publicBookingLimiter, async (req, res) => {
  const settings = await models.getSettings();
  const rerender = (error) => res.status(400).render('public/book', { settings, today: todayStr(), error, values: req.body });

  // Honeypot — real visitors never see or fill this field (hidden via CSS
  // in the form). A bot that fills every field will trip it; we pretend
  // success rather than error out, so it doesn't learn anything.
  if (req.body.website) {
    return res.redirect('/book/thanks');
  }

  const { customerName, phone, email, date, time, partySize, occasion, notes, privacyAcknowledged } = req.body;
  const bookingType = req.body.bookingType === 'function_room' ? 'function_room' : 'table';
  if (!customerName || !phone || !date || !time || !partySize) {
    return rerender('Please fill in your name, phone number, date, time, and party size.');
  }
  if (Number(partySize) < 1) {
    return rerender('Party size must be at least 1.');
  }
  if (!privacyAcknowledged) {
    return rerender('Please confirm you\'ve read the Privacy Notice before submitting.');
  }

  // Function Room / private event requests go through the same online
  // pending-approval flow as a regular table now (previously these were
  // turned away with a "please call us" message) — matched against the
  // two actual Function Room entries (Whitefield Room / Butlerstone Room)
  // instead of Main Floor tables. Still falls back to "call us" if the
  // party is bigger than even the larger room.
  const table = bookingType === 'function_room'
    ? await models.findBestAvailableFunctionRoom({ date, time, durationMinutes: settings.slotDurationMinutes, partySize })
    : await models.findBestAvailableTable({ date, time, durationMinutes: settings.slotDurationMinutes, partySize });
  if (!table) {
    return rerender(bookingType === 'function_room'
      ? `We can't fit a party of ${partySize} in either function room — please call us on ${notify.CONTACT_PHONE} to talk through options.`
      : `We can't seat a party of ${partySize} on the Main Floor — for larger groups, tick "Function Room / private event" above, or call us on ${notify.CONTACT_PHONE}.`);
  }

  const result = await models.createBooking(
    { customerName, phone, email, date, time, partySize, tableId: table.id, occasion, notes },
    null,
    { forcePendingApproval: true }
  );
  if (result.error) {
    return rerender(result.error);
  }

  if (result.booking.email) {
    const { subject, text } = notify.publicBookingReceivedEmail(result.booking);
    notify.sendEmail({ to: result.booking.email, subject, text, type: 'public-booking-received', bookingId: result.booking.id });
  }
  // The form's own copy promises "we'll confirm by text and email" — this
  // was previously missing (only the email above was ever actually sent).
  sms.sendSms({
    to: result.booking.phone,
    body: sms.publicBookingReceivedSms(result.booking),
    type: 'public-booking-received',
    bookingId: result.booking.id
  });
  notify.notifyAllStaffNewPublicBooking(result.booking, table).catch(err => console.error('Public booking staff notify failed:', err.message));

  res.redirect('/book/thanks');
});

router.get('/thanks', (req, res) => {
  res.render('public/book-thanks', {});
});

module.exports = router;
