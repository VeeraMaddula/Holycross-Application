const express = require('express');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const sms = require('../sms');
const googleCalendar = require('../googleCalendar');
const { requireAdmin } = require('../middleware');

router.get('/', (req, res) => {
  const { date, status } = req.query;
  const bookings = models.listBookings({ date, status });
  const tables = models.listTables();
  res.render('bookings/list', { bookings, tables, filterDate: date || '', filterStatus: status || '' });
});

router.get('/new', (req, res) => {
  const tables = models.listTables();
  res.render('bookings/form', { booking: null, tables, error: null });
});

router.post('/', async (req, res) => {
  const tables = models.listTables();
  const result = models.createBooking(req.body, res.locals.currentUser);
  if (result.error) {
    return res.status(400).render('bookings/form', { booking: req.body, tables, error: result.error });
  }
  const table = tables.find(t => t.id === result.booking.tableId);

  // Fire notifications (no-ops gracefully if SMTP/Twilio aren't configured)
  if (result.booking.email) {
    const { subject, text } = notify.bookingConfirmationEmail(result.booking, table ? table.name : 'your table');
    notify.sendEmail({ to: result.booking.email, subject, text, type: 'confirmation', bookingId: result.booking.id });
  }
  if (result.booking.phone) {
    sms.sendSms({
      to: result.booking.phone,
      body: sms.bookingConfirmationSms(result.booking, table ? table.name : 'your table'),
      type: 'confirmation',
      bookingId: result.booking.id
    });
  }
  notify.notifyAdminNewBooking(result.booking, table ? table.name : 'a table');

  // Push to Google Calendar (no-op gracefully if not configured)
  if (googleCalendar.isConfigured()) {
    googleCalendar.createEvent(result.booking, table)
      .then(eventId => { if (eventId) models.setBookingGoogleEventId(result.booking.id, eventId); })
      .catch(err => console.warn('Google Calendar sync (create) failed:', err.message));
  }

  res.redirect(`/bookings/${result.booking.id}`);
});

router.get('/:id', (req, res) => {
  const booking = models.getBooking(req.params.id);
  if (!booking) return res.status(404).render('404');
  const table = models.listTables().find(t => t.id === booking.tableId);
  res.render('bookings/details', { booking, table });
});

router.get('/:id/edit', (req, res) => {
  const booking = models.getBooking(req.params.id);
  if (!booking) return res.status(404).render('404');
  const tables = models.listTables();
  res.render('bookings/form', { booking, tables, error: null });
});

router.post('/:id', (req, res) => {
  const tables = models.listTables();
  const result = models.updateBooking(req.params.id, req.body);
  if (result.error) {
    return res.status(400).render('bookings/form', { booking: { ...req.body, id: req.params.id }, tables, error: result.error });
  }

  if (googleCalendar.isConfigured()) {
    const table = tables.find(t => t.id === result.booking.tableId);
    googleCalendar.updateEvent(result.booking, table)
      .then(eventId => { if (eventId && eventId !== result.booking.googleEventId) models.setBookingGoogleEventId(result.booking.id, eventId); })
      .catch(err => console.warn('Google Calendar sync (update) failed:', err.message));
  }

  res.redirect(`/bookings/${req.params.id}`);
});

router.post('/:id/status', async (req, res) => {
  const { status } = req.body;
  const result = models.setStatus(req.params.id, status);
  if (!result.error && status === 'cancelled') {
    if (result.booking.email) {
      const { subject, text } = notify.cancellationEmail(result.booking);
      notify.sendEmail({ to: result.booking.email, subject, text, type: 'cancellation', bookingId: result.booking.id });
    }
    if (result.booking.phone) {
      sms.sendSms({ to: result.booking.phone, body: sms.cancellationSms(result.booking), type: 'cancellation', bookingId: result.booking.id });
    }
    if (googleCalendar.isConfigured() && result.booking.googleEventId) {
      googleCalendar.deleteEvent(result.booking.googleEventId)
        .then(() => models.setBookingGoogleEventId(result.booking.id, ''))
        .catch(err => console.warn('Google Calendar sync (cancel) failed:', err.message));
    }
  }
  res.redirect(`/bookings/${req.params.id}`);
});

router.post('/:id/payment', requireAdmin, (req, res) => {
  models.updatePayment(req.params.id, req.body);
  res.redirect(`/bookings/${req.params.id}`);
});

router.post('/:id/delete', requireAdmin, (req, res) => {
  const booking = models.getBooking(req.params.id);
  if (booking && googleCalendar.isConfigured() && booking.googleEventId) {
    googleCalendar.deleteEvent(booking.googleEventId).catch(err => console.warn('Google Calendar sync (delete) failed:', err.message));
  }
  models.deleteBooking(req.params.id);
  res.redirect('/bookings');
});

module.exports = router;
