const express = require('express');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const sms = require('../sms');
const googleCalendar = require('../googleCalendar');
const { requireAdmin } = require('../middleware');
const { MANAGER_ROLES } = require('../roles');

// Function Room tables (Whitefield Room, Butlerstone Room) are the big
// event spaces — booking them requires canBookFunctions (Admin/Senior
// Manager have it automatically, same as Timesheets/Roster; everyone else
// needs it granted on the Users page). Bar Staff are hard-blocked from the
// Function Room no matter what — this is a fixed rule, not something the
// per-user canBookFunctions grant can override. Regular Main Floor tables
// are open to anyone with booking access.
function canBookFunctionRoom(user) {
  if (!user) return false;
  if (user.role === 'bar_staff') return false;
  return !!(user.role === 'admin' || user.role === 'senior_manager' || user.canBookFunctions);
}

function requireManagerRole(req, res, next) {
  const u = res.locals.currentUser;
  if (u && MANAGER_ROLES.includes(u.role)) return next();
  return res.status(403).render('403');
}

async function tablesForUser(user) {
  const tables = await models.listTables();
  if (canBookFunctionRoom(user)) return tables;
  return tables.filter(t => t.area !== 'Function Room');
}

// String-compare a table id against a booking's tableId, not === : table.id
// is a SQL-sourced string (INT8-backed SERIAL) while a booking's tableId is
// a plain INT column — same mismatch class fixed throughout this migration.
function findTable(tables, tableId) {
  return tables.find(t => String(t.id) === String(tableId));
}

router.get('/', async (req, res) => {
  const { date, status } = req.query;
  const bookings = await models.listBookings({ date, status });
  const tables = await models.listTables();
  res.render('bookings/list', { bookings, tables, filterDate: date || '', filterStatus: status || '' });
});

router.get('/new', async (req, res) => {
  res.render('bookings/form', { booking: null, tables: await tablesForUser(res.locals.currentUser), error: null });
});

router.post('/', async (req, res) => {
  const tables = await tablesForUser(res.locals.currentUser);
  const chosenTable = findTable(await models.listTables(), req.body.tableId);
  if (chosenTable && chosenTable.area === 'Function Room' && !canBookFunctionRoom(res.locals.currentUser)) {
    return res.status(403).render('bookings/form', { booking: req.body, tables, error: "You don't have permission to book the Function Room. Ask an admin to grant Function bookings access." });
  }

  // Manager-or-above bookings never need approval, even if they overlap an
  // existing booking. Everyone else (Bar Staff) gets a conflicting booking
  // parked as 'pending_approval' instead of rejected outright — see
  // models.createBooking.
  const isManager = MANAGER_ROLES.includes((res.locals.currentUser || {}).role);
  const result = await models.createBooking(req.body, res.locals.currentUser, { autoOverrideConflict: isManager });
  if (result.error) {
    return res.status(400).render('bookings/form', { booking: req.body, tables, error: result.error });
  }
  const table = findTable(tables, result.booking.tableId);

  if (result.booking.status === 'pending_approval') {
    // Conflict held for approval — the customer hears nothing yet. Notify
    // Manager/Floor Manager/Senior Manager/General Manager/Admin so one of
    // them can review and approve or decline it.
    notify.notifyManagersPendingApproval(result.booking, table, result.conflict);
  } else {
    // Fire customer notifications (no-ops gracefully if SMTP/Sendmode aren't configured)
    if (result.booking.email) {
      const { subject, text } = notify.bookingConfirmationEmail(result.booking, table);
      notify.sendEmail({
        to: result.booking.email, subject, text, type: 'confirmation', bookingId: result.booking.id,
        attachments: [notify.bookingIcsAttachment(result.booking, table)]
      });
    }
    if (result.booking.phone) {
      sms.sendSms({
        to: result.booking.phone,
        body: sms.bookingConfirmationSms(result.booking, table),
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
  }

  res.redirect(`/bookings/${result.booking.id}`);
});

router.get('/:id', async (req, res) => {
  const booking = await models.getBooking(req.params.id);
  if (!booking) return res.status(404).render('404');
  const table = findTable(await models.listTables(), booking.tableId);
  res.render('bookings/details', { booking, table });
});

router.get('/:id/edit', async (req, res) => {
  const booking = await models.getBooking(req.params.id);
  if (!booking) return res.status(404).render('404');
  let tables = await tablesForUser(res.locals.currentUser);
  // Keep the booking's current table selectable even if it's a Function Room
  // the editor can't newly assign, so the form doesn't silently blank it out.
  if (!findTable(tables, booking.tableId)) {
    const current = findTable(await models.listTables(), booking.tableId);
    if (current) tables = [...tables, current];
  }
  res.render('bookings/form', { booking, tables, error: null });
});

router.post('/:id', async (req, res) => {
  const tables = await tablesForUser(res.locals.currentUser);
  const existingBooking = await models.getBooking(req.params.id);
  const chosenTable = findTable(await models.listTables(), req.body.tableId);
  const isNewTableAssignment = !existingBooking || String(existingBooking.tableId) !== String(req.body.tableId);
  if (chosenTable && chosenTable.area === 'Function Room' && isNewTableAssignment && !canBookFunctionRoom(res.locals.currentUser)) {
    return res.status(403).render('bookings/form', { booking: { ...req.body, id: req.params.id }, tables, error: "You don't have permission to book the Function Room. Ask an admin to grant Function bookings access." });
  }
  const result = await models.updateBooking(req.params.id, req.body);
  if (result.error) {
    return res.status(400).render('bookings/form', { booking: { ...req.body, id: req.params.id }, tables, error: result.error });
  }

  if (googleCalendar.isConfigured()) {
    const table = findTable(tables, result.booking.tableId);
    googleCalendar.updateEvent(result.booking, table)
      .then(eventId => { if (eventId && eventId !== result.booking.googleEventId) models.setBookingGoogleEventId(result.booking.id, eventId); })
      .catch(err => console.warn('Google Calendar sync (update) failed:', err.message));
  }

  res.redirect(`/bookings/${req.params.id}`);
});

router.post('/:id/status', async (req, res) => {
  const { status } = req.body;
  const result = await models.setStatus(req.params.id, status);
  if (!result.error && status === 'cancelled') {
    if (result.booking.email) {
      const { subject, text } = notify.cancellationEmail(result.booking);
      notify.sendEmail({ to: result.booking.email, subject, text, type: 'cancellation', bookingId: result.booking.id });
    }
    {
      const tables = await models.listTables();
      const table = findTable(tables, result.booking.tableId);
      notify.notifyAdminBookingCancelled(result.booking, table ? table.name : null)
        .catch(err => console.warn('Admin cancellation notification email failed:', err.message));
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

// Manager/Floor Manager/Senior Manager/General Manager/Admin approves a Bar
// Staff booking that was held for a scheduling conflict. Only now does the
// customer get their confirmation email/SMS and does the booking sync to
// Google Calendar.
router.post('/:id/approve', requireManagerRole, async (req, res) => {
  const result = await models.approveBooking(req.params.id, res.locals.currentUser);
  if (result.error) return res.status(400).render('403');
  const table = findTable(await models.listTables(), result.booking.tableId);

  if (result.booking.email) {
    const { subject, text } = notify.bookingConfirmationEmail(result.booking, table);
    notify.sendEmail({
      to: result.booking.email, subject, text, type: 'confirmation', bookingId: result.booking.id,
      attachments: [notify.bookingIcsAttachment(result.booking, table)]
    });
  }
  if (result.booking.phone) {
    sms.sendSms({
      to: result.booking.phone,
      body: sms.bookingConfirmationSms(result.booking, table),
      type: 'confirmation',
      bookingId: result.booking.id
    });
  }
  if (googleCalendar.isConfigured()) {
    googleCalendar.createEvent(result.booking, table)
      .then(eventId => { if (eventId) models.setBookingGoogleEventId(result.booking.id, eventId); })
      .catch(err => console.warn('Google Calendar sync (create) failed:', err.message));
  }

  res.redirect(`/bookings/${req.params.id}`);
});

router.post('/:id/payment', requireAdmin, async (req, res) => {
  await models.updatePayment(req.params.id, req.body);
  res.redirect(`/bookings/${req.params.id}`);
});

router.post('/:id/delete', requireAdmin, async (req, res) => {
  const booking = await models.getBooking(req.params.id);
  if (booking && googleCalendar.isConfigured() && booking.googleEventId) {
    googleCalendar.deleteEvent(booking.googleEventId).catch(err => console.warn('Google Calendar sync (delete) failed:', err.message));
  }
  await models.deleteBooking(req.params.id);
  res.redirect('/bookings');
});

module.exports = router;
// Exposed for the test suite (tests/booking-approval.test.js) — Express
// routers are plain functions, so attaching extra named exports alongside
// the router itself is safe and doesn't affect how server.js mounts it.
module.exports.canBookFunctionRoom = canBookFunctionRoom;
