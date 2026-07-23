const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { readDb } = require('./db');
const models = require('./models');
const sms = require('./sms');
const { MANAGER_ROLES } = require('./roles');
const { DUTY_ESCALATION_ROLES } = require('./duties');
const dutyWindows = require('./dutyWindows');
const { toDateStr } = require('./dateUtils');
const calendarLinks = require('./calendarLinks');

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

async function sendEmail({ to, subject, text, html, type, bookingId, attachments }) {
  if (!to) return;
  const t = getTransporter();
  if (!t) {
    models.logNotification({ type, bookingId, recipient: to, subject, text, status: 'skipped-no-smtp' });
    return;
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to, subject, text, html,
      attachments: attachments || undefined
    });
    models.logNotification({ type, bookingId, recipient: to, subject, text, status: 'sent' });
  } catch (err) {
    models.logNotification({ type, bookingId, recipient: to, subject, text, status: 'failed', error: err.message });
  }
}

// A booking's confirmation email always gets a matching .ics attachment —
// opening it lets Google/Apple/Outlook calendar apps add the event with no
// clicks on a link required. Kept separate from the email body builders
// below so callers can attach it via sendEmail's `attachments` option.
function bookingIcsAttachment(booking, table) {
  return {
    filename: 'booking.ics',
    content: calendarLinks.bookingIcs(booking, table),
    contentType: 'text/calendar; charset=utf-8; method=PUBLISH'
  };
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

// Only meaningful once the app is actually hosted somewhere with a real
// domain (see PUBLIC_BASE_URL in .env) — blank locally, so the link is
// simply left out rather than pointing at nothing useful.
function publicMenuLink() {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/our-menu` : '';
}

function bookingConfirmationEmail(booking, table) {
  const subject = `Booking confirmed - The Holy Cross, ${booking.date} at ${booking.time}`;
  const details = bookingDetailLines(booking, table).map(l => `  - ${l}`).join('\n');
  const menuLink = publicMenuLink();
  const calendarLink = calendarLinks.googleCalendarAddLink(booking, table);
  const text = `Hi ${booking.customerName},\n\n`
    + `A warm welcome from all of us at The Holy Cross, and thank you for booking with us!\n\n`
    + `Here are your booking details:\n${details}\n\n`
    + `We'll be in touch nearer your booking, and we'll send you a reminder again by both text and email closer to the date.\n\n`
    + `Add it to your calendar: ${calendarLink}\n`
    + `(or open the attached file to add it to Apple/Outlook/any calendar app)\n\n`
    + (menuLink ? `Take a look at what's on the menu: ${menuLink}\n\n` : '')
    + `For more information, please contact us on ${CONTACT_PHONE}.\n\n`
    + `Follow us on Facebook for more news and updates from The Holy Cross.\n\n`
    + `Thanks again for booking with us - we can't wait to welcome you!\n\nThe Holy Cross`;
  return { subject, text };
}

// Sent immediately when a customer submits the public "Reserve a table"
// form — before any Manager has looked at it. Sets expectations (60
// minutes) rather than leaving them wondering whether it went through.
function publicBookingReceivedEmail(booking) {
  const subject = `We've got your booking request - The Holy Cross`;
  const text = `Hi ${booking.customerName},\n\n`
    + `Thanks for your booking request for ${booking.partySize} guest${booking.partySize === 1 ? '' : 's'} on ${booking.date} at ${booking.time}.\n\n`
    + `We haven't confirmed it yet — a member of our team reviews every online request and will send you a confirmation by text and email within 60 minutes.\n\n`
    + `If you don't hear from us in that time, please call us on ${CONTACT_PHONE}.\n\nThe Holy Cross`;
  return { subject, text };
}

// Sent to every member of staff (not just Managers) the moment a public
// booking request comes in — so everyone can see it on the Bookings page,
// even though only a Manager/Floor Manager/Senior Manager/General
// Manager/Admin can actually approve it.
function newPublicBookingRequestEmail(booking, table) {
  const subject = `New online booking request: ${booking.customerName} - ${booking.date} at ${booking.time}`;
  const text = `A new booking request came in from the website, awaiting Manager approval:\n\n`
    + `  - Customer: ${booking.customerName}\n`
    + `  - Party size: ${booking.partySize}\n`
    + `  - Date: ${booking.date} at ${booking.time}\n`
    + `  - Suggested table: ${table ? table.name : 'none available for that party size'}\n`
    + (booking.occasion ? `  - Occasion: ${booking.occasion}\n` : '')
    + (booking.notes ? `  - Notes: ${booking.notes}\n` : '')
    + `\nView and approve it in the app under Bookings (booking #${booking.id}).`;
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

// Forgot-password reset link. The token in the link is one-time-use and
// expires after 1 hour (see models.createPasswordResetToken).
function passwordResetEmail(user, resetLink) {
  const subject = `Reset your password - The Holy Cross`;
  const text = `Hi ${user.name},\n\n`
    + `We received a request to reset your password for The Holy Cross booking admin.\n\n`
    + `Reset it here (this link expires in 1 hour):\n${resetLink}\n\n`
    + `If you didn't request this, you can safely ignore this email — your password won't change.\n\n`
    + `For more information, please contact us on ${CONTACT_PHONE}.\n\nThe Holy Cross`;
  return { subject, text };
}

// Sent to Manager/Floor Manager/Senior Manager/General Manager/Admin when
// someone taps "Forgot PIN?" on the kiosk. There's no self-service PIN
// reset by design — that would defeat the point of a PIN-gated clock-in —
// so this just routes the request to whoever can set a new one from the
// Users page.
function pinResetRequestEmail(user) {
  const subject = `PIN reset needed: ${user.name}`;
  const text = `${user.name} tapped "Forgot PIN?" on the kiosk and needs their clock-in PIN reset.\n\n`
    + `Set a new PIN for them from Users → ${user.name} → Clock-in kiosk PIN.`;
  return { subject, text };
}

// Sent to General Manager / Senior Manager / Floor Manager when a kiosk
// duties window (Opening, After Breakfast, After Carvery, Closing) closes
// with something left unticked — whether that's because a Bar Staff member
// hit Submit and explained why, or because nobody confirmed it at all and
// the automatic check caught it.
function dutyMissedEmail(report) {
  const subject = `Duties alert: ${report.sectionTitle} not fully done - ${report.date}`;
  const missingLines = report.missingTaskTexts && report.missingTaskTexts.length
    ? report.missingTaskTexts.map(t => `  - ${t}`).join('\n')
    : '  (none listed)';
  const staffLine = report.staffOnShiftNames && report.staffOnShiftNames.length
    ? report.staffOnShiftNames.join(', ')
    : 'No Bar Staff currently clocked in';
  const text = `${report.sectionTitle} on ${report.date} was not fully completed.\n\n`
    + `Not ticked off:\n${missingLines}\n\n`
    + `Reason given: ${report.reason || '(no reason given)'}\n\n`
    + `Bar Staff on shift: ${staffLine}\n\n`
    + `Check the Duties page in the app for the full checklist.`;
  return { subject, text };
}

// Sent to the one specific person a "Report an Issue" was addressed to —
// never broadcast to anyone else, and never seen by whoever/whatever is
// being reported about.
function reportSubmittedEmail(report) {
  const subject = `New report (${report.categoryLabel}) from ${report.reportedByName}`;
  const fileNote = report.files && report.files.length
    ? `\n\n${report.files.length} file(s)/photo(s) attached — view them in the app under Reports.`
    : '';
  const text = `${report.reportedByName} filed a report: ${report.categoryLabel}.\n\n`
    + `Details:\n${report.details || '(no details given)'}${fileNote}\n\n`
    + `Review it in the app under Reports.`;
  return { subject, text };
}

// Sent only to Senior Manager(s) whenever a Cash Safe Log entry is
// submitted — not the broader DUTY_ESCALATION_ROLES, not Admin/GM/FM, per
// the specific request that this go to Senior Manager only.
function cashSafeLogEmail(entry) {
  const flag = entry.total !== 1000 ? `\n\nNOTE: Safe balance is currently EUR ${entry.total.toFixed(2)}, not the usual EUR 1000.00 — please check.` : '';
  const subject = `Cash safe log: ${entry.loggedByName} - ${entry.date} (new total EUR ${entry.total.toFixed(2)})`;
  const text = `${entry.loggedByName} logged a cash safe change on ${entry.date}.\n\n`
    + `Reason: ${entry.reason || '(no reason given)'}\n\n`
    + `Coins in: EUR ${entry.coinsIn.toFixed(2)}\n`
    + `Coins out: EUR ${entry.coinsOut.toFixed(2)}\n`
    + `Notes in: EUR ${entry.notesIn.toFixed(2)}\n`
    + `Notes out: EUR ${entry.notesOut.toFixed(2)}\n\n`
    + `New safe total: EUR ${entry.total.toFixed(2)}${flag}\n\n`
    + `Check the Cash Safe Log in the app for the full history.`;
  return { subject, text };
}

async function notifySeniorManagerCashLog(entry) {
  const recipients = models.listUsers().filter(u => u.role === 'senior_manager' && u.email);
  const { subject, text } = cashSafeLogEmail(entry);
  for (const m of recipients) {
    await sendEmail({ to: m.email, subject, text, type: 'cash-safe-log' });
  }
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

// Every active staff account (not just Managers) gets told about a new
// public booking request — Bar/Kitchen Staff can see it on the Bookings
// page but can't approve it; only a Manager-tier account can.
async function notifyAllStaffNewPublicBooking(booking, table) {
  const staff = models.listUsers().filter(u => u.active && u.role !== 'kiosk' && u.email);
  const { subject, text } = newPublicBookingRequestEmail(booking, table);
  for (const s of staff) {
    await sendEmail({ to: s.email, subject, text, type: 'public-booking-request', bookingId: booking.id });
  }
}

// Kiosk "Forgot PIN?" — same manager audience as the booking-approval alert.
async function notifyManagersPinResetRequest(user) {
  const managers = models.listUsers().filter(u => MANAGER_ROLES.includes(u.role) && u.email);
  const { subject, text } = pinResetRequestEmail(user);
  for (const m of managers) {
    await sendEmail({ to: m.email, subject, text, type: 'pin-reset-request' });
  }
}

// Duties escalation audience is narrower than the usual MANAGER_ROLES set —
// General Manager, Senior Manager, Floor Manager only (see duties.js).
async function notifyManagersDutyReport(report) {
  const recipients = models.listUsers().filter(u => DUTY_ESCALATION_ROLES.includes(u.role) && u.email);
  const { subject, text } = dutyMissedEmail(report);
  for (const m of recipients) {
    await sendEmail({ to: m.email, subject, text, type: 'duty-missed' });
  }
}

// Evaluates one duty section for one date and, if it's incomplete and
// hasn't already been reported, records + emails it. Shared by the fixed-
// window sweep, the lastClockout closing check, and the overnight safety
// net below — all three just disagree on *when* to call this.
async function evaluateAndReportDuty({ date, section, sectionTitle, trigger, fallbackReason }) {
  if (models.getDutyReport(date, section)) return; // already handled today
  const checklist = models.getDutiesChecklist(date);
  const sectionData = checklist.sections.find(s => s.key === section);
  if (!sectionData) return;
  const missing = sectionData.tasks.filter(t => !t.done);
  const { report, isNewIncomplete } = models.recordDutyReport({
    date,
    section,
    sectionTitle: sectionTitle || sectionData.title,
    complete: missing.length === 0,
    reason: missing.length ? fallbackReason : '',
    missingTaskTexts: missing.map(t => t.text),
    staffOnShiftNames: models.getBarStaffOnShiftNames(),
    trigger
  });
  if (isNewIncomplete) await notifyManagersDutyReport(report);
}

// Runs every 5 minutes (see startScheduler below). Catches the fixed-time
// windows (Opening, After Breakfast, After Carvery, Sunday's Closing) that
// nobody ever opened or submitted on the kiosk, plus an overnight safety
// net for the lastClockout-style Closing windows in case a clock-out was
// never tapped at all.
async function runDutyWindowSweep() {
  const now = new Date();
  const ended = dutyWindows.getEndedFixedWindows(now);
  for (const w of ended) {
    await evaluateAndReportDuty({
      date: toDateStr(w.day),
      section: w.section,
      sectionTitle: w.sectionTitle,
      trigger: 'auto-sweep',
      fallbackReason: '(not submitted on the kiosk — window closed automatically)'
    });
  }
  await checkStaleClosingWindows(now);
}

// Safety net for lastClockout Closing windows: if it's well past a
// reasonable overnight cutoff (2:30am) and the window still hasn't been
// resolved (no clock-out ever triggered the check — e.g. someone forgot to
// tap out), report it anyway rather than leaving it open forever.
async function checkStaleClosingWindows(now) {
  for (const offset of [0, 1]) {
    const day = dutyWindows.addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -offset);
    const windowsToday = dutyWindows.DUTY_WINDOWS.filter(w => w.endMode === 'lastClockout' && w.days.includes(day.getDay()));
    for (const w of windowsToday) {
      const cutoff = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 2, 30, 0, 0);
      if (now < cutoff) continue;
      await evaluateAndReportDuty({
        date: toDateStr(day),
        section: w.section,
        sectionTitle: w.sectionTitle,
        trigger: 'auto-stale',
        fallbackReason: '(not confirmed — no clock-out detected before the overnight cutoff)'
      });
    }
  }
}

// Called from routes/kiosk.js right after a Bar Staff clock-out. If that
// leaves nobody from Bar Staff still clocked in, and we're inside a
// lastClockout Closing window, this was "the last person out" — the moment
// the closing checklist is supposed to have been checked. Evaluates and
// reports immediately rather than waiting for the 5-minute sweep.
async function checkClosingDutiesOnClockOut(now = new Date()) {
  const win = dutyWindows.getWindowForNow(now);
  if (!win || win.section !== 'closing' || win.endMode !== 'lastClockout') return;
  const stillIn = models.getBarStaffOnShiftNames();
  if (stillIn.length > 0) return; // not the last one out yet
  await evaluateAndReportDuty({
    date: toDateStr(win.businessDate),
    section: 'closing',
    sectionTitle: win.sectionTitle,
    trigger: 'auto-clockout',
    fallbackReason: '(not confirmed before clocking out)'
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

  // Runs every 5 minutes to catch duty windows nobody confirmed on the
  // kiosk (fixed-time windows), plus the overnight safety net for
  // Closing's lastClockout windows.
  cron.schedule('*/5 * * * *', () => {
    runDutyWindowSweep().catch(err => console.error('Duty window sweep failed:', err.message));
  });
  console.log('Duty window sweep started (checks every 5 minutes).');
}

module.exports = {
  sendEmail, bookingConfirmationEmail, bookingIcsAttachment, bookingReminderEmail, cancellationEmail,
  shiftAssignedEmail, shiftUpdatedEmail, newRequestEmail, pendingApprovalEmail,
  passwordResetEmail, pinResetRequestEmail, dutyMissedEmail, reportSubmittedEmail,
  publicBookingReceivedEmail, newPublicBookingRequestEmail, cashSafeLogEmail,
  notifyAdminNewBooking, notifyManagersPendingApproval, notifyManagersPinResetRequest,
  notifyManagersDutyReport, notifyAllStaffNewPublicBooking, notifySeniorManagerCashLog,
  runDutyWindowSweep, checkClosingDutiesOnClockOut,
  runReminderSweep, startScheduler, getTransporter, CONTACT_PHONE
};
