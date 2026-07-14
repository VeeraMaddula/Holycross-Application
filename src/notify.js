const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { readDb } = require('./db');
const models = require('./models');
const sms = require('./sms');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null; // email not configured
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

async function sendEmail({ to, subject, text, html, type, bookingId }) {
  if (!to) return;
  const t = getTransporter();
  if (!t) {
    models.logNotification({ type, bookingId, recipient: to, subject, status: 'skipped-no-smtp' });
    return;
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to, subject, text, html
    });
    models.logNotification({ type, bookingId, recipient: to, subject, status: 'sent' });
  } catch (err) {
    models.logNotification({ type, bookingId, recipient: to, subject, status: 'failed', error: err.message });
  }
}

function bookingConfirmationEmail(booking, tableName) {
  const subject = `Booking confirmed: ${booking.date} at ${booking.time}`;
  const text = `Hi ${booking.customerName},\n\nYour booking is confirmed for ${booking.partySize} people on ${booking.date} at ${booking.time} (${tableName}).\n\nSee you soon!`;
  return { subject, text };
}

function bookingReminderEmail(booking, tableName) {
  const subject = `Reminder: your booking is coming up (${booking.date} at ${booking.time})`;
  const text = `Hi ${booking.customerName},\n\nJust a reminder that your table for ${booking.partySize} is booked for ${booking.date} at ${booking.time} (${tableName}).\n\nWe look forward to seeing you!`;
  return { subject, text };
}

function cancellationEmail(booking) {
  const subject = `Booking cancelled: ${booking.date} at ${booking.time}`;
  const text = `Hi ${booking.customerName},\n\nYour booking for ${booking.date} at ${booking.time} has been cancelled. Contact us if this wasn't expected.`;
  return { subject, text };
}

function shiftAssignedEmail(shift, userName) {
  const subject = `New shift: ${shift.date} ${shift.startTime}–${shift.endTime}`;
  const text = `Hi ${userName},\n\nYou've been scheduled for a shift on ${shift.date} from ${shift.startTime} to ${shift.endTime}.\n\nCheck My Shifts in the app for your full schedule.`;
  return { subject, text };
}

function shiftUpdatedEmail(shift, userName) {
  const subject = `Shift updated: ${shift.date} ${shift.startTime}–${shift.endTime}`;
  const text = `Hi ${userName},\n\nYour shift on ${shift.date} has been updated. It's now ${shift.startTime} to ${shift.endTime}.\n\nCheck My Shifts in the app for your full schedule.`;
  return { subject, text };
}

function newRequestEmail(request) {
  const subject = `New ${request.typeLabel} request from ${request.requestedByName}`;
  const text = `Hi ${request.recipientName},\n\n${request.requestedByName} sent you a ${request.typeLabel.toLowerCase()} request:\n\n"${request.details}"\n\nCheck Requests in the app to follow up.`;
  return { subject, text };
}

async function notifyAdminNewBooking(booking, tableName) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!adminEmail) return;
  await sendEmail({
    to: adminEmail,
    subject: `New booking: ${booking.customerName} - ${booking.date} ${booking.time}`,
    text: `${booking.customerName} (${booking.phone || booking.email}) booked ${tableName} for ${booking.partySize} on ${booking.date} at ${booking.time}.`,
    type: 'admin-new-booking',
    bookingId: booking.id
  });
}

// Checks for bookings starting within the reminder window and sends a reminder once.
async function runReminderSweep() {
  const db = readDb();
  const hoursBefore = db.settings.reminderHoursBefore || 24;
  const now = new Date();
  for (const booking of db.bookings) {
    if (booking.status !== 'confirmed' || booking.reminderSent || (!booking.email && !booking.phone)) continue;
    const bookingDateTime = new Date(`${booking.date}T${booking.time}:00`);
    const hoursUntil = (bookingDateTime - now) / (1000 * 60 * 60);
    if (hoursUntil > 0 && hoursUntil <= hoursBefore) {
      const table = db.tables.find(t => t.id === booking.tableId);
      if (booking.email) {
        const { subject, text } = bookingReminderEmail(booking, table ? table.name : 'your table');
        await sendEmail({ to: booking.email, subject, text, type: 'reminder', bookingId: booking.id });
      }
      if (booking.phone) {
        await sms.sendSms({ to: booking.phone, body: sms.bookingReminderSms(booking, table ? table.name : 'your table'), type: 'reminder', bookingId: booking.id });
      }
      models.updateBookingReminderFlag && models.updateBookingReminderFlag(booking.id);
      // Mark reminderSent directly via models
      const dbFresh = readDb();
      const b = dbFresh.bookings.find(x => x.id === booking.id);
      if (b) {
        b.reminderSent = true;
        require('./db').writeDb(dbFresh);
      }
    }
  }
}

function startScheduler() {
  // Runs every 15 minutes to catch bookings entering the reminder window.
  cron.schedule('*/15 * * * *', () => {
    runReminderSweep().catch(err => console.error('Reminder sweep failed:', err.message));
  });
  console.log('Reminder scheduler started (checks every 15 minutes).');
}

module.exports = {
  sendEmail, bookingConfirmationEmail, bookingReminderEmail, cancellationEmail,
  shiftAssignedEmail, shiftUpdatedEmail, newRequestEmail,
  notifyAdminNewBooking, runReminderSweep, startScheduler, getTransporter
};
