const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { readDb } = require('./db');
const models = require('./models');
const sms = require('./sms');
const { MANAGER_ROLES } = require('./roles');

const CONTACT_PHONE = '+353 51 353087';

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
    models.logNotification({ type, bookingId, recipient: to, subject, text, status: 'skipped-no-smtp' });
    return;
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to, subject, text, html
    });
    models.logNotification({ type, bookingId, recipient: to, subject, text, status: 'sent' });
  } catch (err) {
    models.logNotification({ type, bookingId, recipient: to, subject, text, status: 'failed', error: err.message });
  }
}

// Booking details for the customer, in a fixed order. We deliberately never
// mention which specific table a booking is on — that's an internal seating
// detail. The exception is a Function Room (Whitefield Room / Butlerstone
// Room): the customer picked that room on purpose, so it's worth confirming.
function bookingDetailLines(booking, table) {
  const lines = [
    `Date: ${booking.date}`,
    `Time: ${booking.time}`,
    `Party size: ${booking.partySize} guest${booking.partySize === 1 ? '' : 's'}`
  ];
  if (table && table.area === 'Function Room') lines.push(`Room: ${table.name}`);
  if (booking.occasion) lines.push(`Occasion: ${booking.occasion}`);
  return lines;
}

function bookingConfirmationEmail(booking, table) {
  const subject = `Booking confirmed - The Holy Cross, ${booking.date} at ${booking.time}`;
  const details = bookingDetailLines(booking, table).map(l => `  - ${l}`).join('\n');
  const text = `Hi ${booking.customerName},\n\n`
    + `A warm welcome from all of us at The Holy Cross, and thank you for booking with us!\n\n`
    + `Here are your booking details:\n${details}\n\n`
    + `We'll be in touch nearer your booking, and we'll send you a reminder again by both text and email closer to the date.\n\n`
    + `For more information, please contact us on ${CONTACT_PHONE}.\n\n`
    + `Follow us on Facebook for more news and updates from The Holy Cross.\n\n`
    + `Thanks again for booking with us - we can't wait to welcome you!\n\nThe Holy Cross`;
  return { subject, text };
}

function bookingReminderEmail(booking, table) {
  const subject = `Reminder: your booking at The Holy Cross is coming up`;
  const details = bookingDetailLines(booking, table).map(l => `  - ${l}`).join('\n');
  const text = `Hi ${booking.customerName},\n\n`
    + `Just a reminder that your booking with us is coming up:\n${details}\n\n`
    + `For more information, please contact us on ${CONTACT_PHONE}.\n\n`
    + `We look forward to seeing you!\n\nThe Holy Cross`;
  return { subject, text };
}

function cancellationEmail(booking) {
  const subject = `Booking cancelled: ${booking.date} at ${booking.time}`;
  const text = `Hi ${booking.customerName},\n\nYour booking for ${booking.date} at ${booking.time} has been cancelled. If this wasn't expected, please contact us on ${CONTACT_PHONE}.`;
  return { subject, text };
}

// Sent to Manager / Floor Manager / Senior Manager (and Admin) when a Bar
// Staff booking overlaps an existing one — the customer is NOT told it's
// confirmed until one of these roles reviews and approves it in the app.
function pendingApprovalEmail(booking, table, conflict) {
  const subject = `Approval needed: booking conflict for ${booking.date} at ${booking.time}`;
  const text = `${booking.createdByName || 'A staff member'} tried to book ${table ? table.name : 'a table'} `
    + `for ${booking.customerName} (${booking.partySize} guests) on ${booking.date} at ${booking.time}.\n\n`
    + `This overlaps with an existing booking for ${conflict.customerName} at ${conflict.time} on ${conflict.date}.\n\n`
    + `The customer has NOT been sent a confirmation yet. Review booking #${booking.id} in the app to approve or decline it.`;
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

// Emails every Manager / Floor Manager / Senior Manager / General Manager /
// Admin who has an email on file — a Bar Staff booking hit a scheduling
// conflict and needs one of them to approve it before the customer hears
// anything.
async function notifyManagersPendingApproval(booking, table, conflict) {
  const managers = models.listUsers().filter(u => MANAGER_ROLES.includes(u.role) && u.email);
  const { subject, text } = pendingApprovalEmail(booking, table, conflict);
  for (const m of managers) {
    await sendEmail({ to: m.email, subject, text, type: 'pending-approval', bookingId: booking.id });
  }
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
        const { subject, text } = bookingReminderEmail(booking, table);
        await sendEmail({ to: booking.email, subject, text, type: 'reminder', bookingId: booking.id });
      }
      if (booking.phone) {
        await sms.sendSms({ to: booking.phone, body: sms.bookingReminderSms(booking, table), type: 'reminder', bookingId: booking.id });
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
  shiftAssignedEmail, shiftUpdatedEmail, newRequestEmail, pendingApprovalEmail,
  notifyAdminNewBooking, notifyManagersPendingApproval, runReminderSweep, startScheduler, getTransporter
};
