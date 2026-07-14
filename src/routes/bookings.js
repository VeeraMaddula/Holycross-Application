const express = require('express');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const sms = require('../sms');
const googleCalendar = require('../googleCalendar');
const { requireAdmin } = require('../middleware');

// Function Room tables (Whitefield Room, Butlerstone Room) are the big
// event spaces — booking them requires canBookFunctions (Admin/Senior
// Manager have it automatically, same as Timesheets/Roster; everyone else
// needs it granted on the Users page). Regular Main Floor tables are open
// to anyone with booking access.
function canBookFunctionRoom(user) {
  return !!(user && (user.role === 'admin' || user.role === 'senior_manager' || user.canBookFunctions));
}

function tablesForUser(user) {
  const tables = models.listTables();
  if (canBookFunctionRoom(user)) return tables;
  return tables.filter(t => t.area !== 'Function Room');
}

router.get('/', (req, res) => {
  const { date, status } = req.query;
  const bookings = models.listBookings({ date, status });
  const tables = models.listTables();
  res.render('bookings/list', { bookings, tables, filterDate: date || '', filterStatus: status || '' });
});

router.get('/new', (req, res) => {
  res.render('bookings/form', { booking: null, tables: tablesForUser(res.locals.currentUser), error: null });
});

router.post('/', async (req, res) => {
  const tables = tablesForUser(res.locals.currentUser);
  const chosenTable = models.listTables().find(t => t.id === Number(req.body.tableId));
  if (chosenTable && chosenTable.area === 'Function Room' && !canBookFunctionRoom(res.locals.currentUser)) {
    return res.status(403).render('bookings/form', { booking: req.body, tables, error: "You don't have permission to book the Function Room. Ask an admin to grant Function bookings access." });
  }
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
  let tables = tablesForUser(res.locals.currentUser);
  // Keep the booking's current table selectable even if it's a Function Room
  // the editor can't newly assign, so the form doesn't silently blank it out.
  if (!tables.some(t => t.id === booking.tableId)) {
    const current = models.listTables().find(t => t.id === booking.tableId);
    if (current) tables = [...tables, current];
  }
  res.render('bookings/form', { booking, tables, error: null });
});

router.post('/:id', (req, res) => {
  const tables = tablesForUser(res.locals.currentUser);
  const existingBooking = models.getBooking(req.params.id);
  const chosenTable = models.listTables().find(t => t.id === Number(req.body.tableId));
  const isNewTableAssignment = !existingBooking || existingBooking.tableId !== Number(req.body.tableId);
  if (chosenTable && chosenTable.area === 'Function Room' && isNewTableAssignment && !canBookFunctionRoom(res.locals.currentUser)) {
    return res.status(403).render('bookings/form', { booking: { ...req.body, id: req.params.id }, tables, error: "You don't have permission to book the Function Room. Ask an admin to grant Function bookings access." });
  }
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
