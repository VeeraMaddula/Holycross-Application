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

// Picks which mailbox a notification appears to come from, based on its
// `type` tag. Lets staff filter/recognise emails at a glance (a shift
// notice from shifts@, a request from requests@, etc.) without needing
// separate mailboxes set up anywhere — Resend just needs the domain
// verified once (see SMTP_FROM's own setup), and any address at that
// domain works as a "from". Each SMTP_FROM_* var is optional; anything left
// unset just falls back to the default SMTP_FROM.
function fromAddressForType(type) {
  const fallback = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (type && type.startsWith('shift')) return process.env.SMTP_FROM_SHIFTS || fallback;
  if (type === 'staff-request') return process.env.SMTP_FROM_REQUESTS || fallback;
  if (type === 'staff-report') return process.env.SMTP_FROM_REPORTS || fallback;
  if (type === 'password-reset') return process.env.SMTP_FROM_PASSWORD_RESET || fallback;
  if (type === 'staff-welcome') return process.env.SMTP_FROM_HR || fallback;
  if (type === 'stock-delivery') return process.env.SMTP_FROM_STOCK || fallback;
  return fallback;
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
      from: fromAddressForType(type),
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
  const isFunctionRoom = table && table.area === 'Function Room';
  const subject = `New online ${isFunctionRoom ? 'Function Room ' : ''}booking request: ${booking.customerName} - ${booking.date} at ${booking.time}`;
  const text = `A new ${isFunctionRoom ? 'Function Room / private event' : 'table'} booking request came in from the website, awaiting Manager approval:\n\n`
    + `  - Customer: ${booking.customerName}\n`
    + `  - Party size: ${booking.partySize}\n`
    + `  - Date: ${booking.date} at ${booking.time}\n`
    + `  - Suggested ${isFunctionRoom ? 'room' : 'table'}: ${table ? table.name : 'none available for that party size'}\n`
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

// Self-service verification code (Profile page: change password / kiosk
// PIN). Short-lived (10 minutes — see selfVerification.js) and single-
// purpose, so the email is deliberately plain: just the code and what it's
// for, nothing to click.
function selfVerificationCodeEmail(user, code, purpose) {
  const what = purpose === 'pin' ? 'kiosk PIN' : 'password';
  const subject = `Your verification code: ${code}`;
  const text = `Hi ${user.name},\n\n`
    + `Use this code to confirm changing your ${what}:\n\n${code}\n\n`
    + `This code expires in 10 minutes.\n\n`
    + `If you didn't request this, you can safely ignore this email — your ${what} won't change.\n\n`
    + `For more information, please contact us on ${CONTACT_PHONE}.\n\nThe Holy Cross`;
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

// Sent once, right when an admin creates a new staff account (see
// routes/users.js's POST '/' handler) — gives them everything needed for
// their first login in one place: the site address, their username and
// password, and their kiosk PIN if one was set at creation time (the PIN
// is optional at creation — if it was left blank, this says so instead of
// printing an empty line, and points them at a manager rather than
// implying they can set it themselves, since there's no self-service PIN
// reset by design — see pinResetRequestEmail above).
function staffWelcomeEmail(user, { username, password, pin }) {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const loginLink = base ? `${base}/login` : '';
  const subject = `Welcome to The Holy Cross Booking & Training Platform`;
  const text = `Hi ${user.name},\n\n`
    + `Welcome to The Holy Cross Booking and Training platform! Your account is ready — here are your login details:\n\n`
    + (loginLink ? `Site: ${loginLink}\n` : '')
    + `Username: ${username}\n`
    + `Password: ${password}\n`
    + (pin
      ? `Kiosk PIN: ${pin}\n`
      : `Kiosk PIN: not set yet — ask a manager to set one for you so you can clock in/out on the kiosk.\n`)
    + `\nWe'd recommend changing your password the first time you log in (see Profile in the app).\n\n`
    + `If you have any questions, just ask a manager.\n\nThe Holy Cross`;
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
  const recipients = (await models.listUsers()).filter(u => u.role === 'senior_manager' && u.email);
  const { subject, text } = cashSafeLogEmail(entry);
  for (const m of recipients) {
    await sendEmail({ to: m.email, subject, text, type: 'cash-safe-log' });
  }
}

function shiftAssignedEmail(shift, userName) {
  const areaSuffix = shift.areaLabel ? ` on the ${shift.areaLabel}` : '';
  const subject = `New shift: ${shift.date} ${shift.startTime}–${shift.endTime}${shift.areaLabel ? ` (${shift.areaLabel})` : ''}`;
  const text = `Hi ${userName},\n\nYou've been scheduled for a shift on ${shift.date} from ${shift.startTime} to ${shift.endTime}${areaSuffix}.\n\nCheck My Shifts in the app for your full schedule.`;
  return { subject, text };
}

function shiftUpdatedEmail(shift, userName) {
  const areaSuffix = shift.areaLabel ? ` on the ${shift.areaLabel}` : '';
  const subject = `Shift updated: ${shift.date} ${shift.startTime}–${shift.endTime}${shift.areaLabel ? ` (${shift.areaLabel})` : ''}`;
  const text = `Hi ${userName},\n\nYour shift on ${shift.date} has been updated. It's now ${shift.startTime} to ${shift.endTime}${areaSuffix}.\n\nCheck My Shifts in the app for your full schedule.`;
  return { subject, text };
}

function newRequestEmail(request) {
  const subject = `New ${request.typeLabel} request from ${request.requestedByName}`;
  const text = `Hi ${request.recipientName},\n\n${request.requestedByName} sent you a ${request.typeLabel.toLowerCase()} request:\n\n"${request.details}"\n\nCheck Requests in the app to follow up.`;
  return { subject, text };
}

// Shift Marketplace — sent to the original shift owner once someone else
// picks up (takes over outright, no swap) the shift they dropped.
function shiftDropPickedUpEmail(shift, pickedUpByName) {
  const subject = `Your dropped shift was picked up: ${shift.date} ${shift.startTime}-${shift.endTime}`;
  const text = `Hi,\n\n${pickedUpByName} picked up the shift you dropped on ${shift.date} (${shift.startTime}-${shift.endTime}).\n\nIt's no longer on your schedule — check My Shifts in the app to confirm.`;
  return { subject, text };
}

// Shift Marketplace — sent to whoever just picked up a dropped shift,
// confirming it's now theirs.
function shiftClaimedEmail(shift, userName) {
  const subject = `You picked up a shift: ${shift.date} ${shift.startTime}-${shift.endTime}`;
  const text = `Hi ${userName},\n\nYou picked up the shift on ${shift.date} from ${shift.startTime} to ${shift.endTime}.\n\nIt's now on your schedule — check My Shifts in the app.`;
  return { subject, text };
}

// Shift Marketplace — sent to BOTH parties of an exchange, each told about
// their own new shift and what they gave up. Call once per recipient with
// their own new shift / old shift date.
function shiftExchangeEmail(newShift, userName, oldShiftDate) {
  const subject = `Shift exchanged: now ${newShift.date} ${newShift.startTime}-${newShift.endTime}`;
  const text = `Hi ${userName},\n\nYour shift exchange went through. You're now down for ${newShift.date} from ${newShift.startTime} to ${newShift.endTime}, in place of your shift on ${oldShiftDate}.\n\nCheck My Shifts in the app for your full schedule.`;
  return { subject, text };
}

// Shift Marketplace — FYI-only email to Managers once a drop resolves.
// There's no approval gate (it's already applied to the roster by the time
// this sends) — this is purely so Managers know the roster changed and who
// changed it.
function shiftChangeManagerEmail({ kind, dropperName, claimantName, droppedShift, offerShift }) {
  if (kind === 'exchanged') {
    const subject = `Shift exchange: ${dropperName} and ${claimantName}`;
    const text = `${dropperName} and ${claimantName} exchanged shifts via the Shift Marketplace.\n\n`
      + `${claimantName} is now down for ${droppedShift.date} (${droppedShift.startTime}-${droppedShift.endTime}), previously ${dropperName}'s.\n`
      + `${dropperName} is now down for ${offerShift.date} (${offerShift.startTime}-${offerShift.endTime}), previously ${claimantName}'s.\n\n`
      + `The roster has already been updated — this is an FYI, no action needed.`;
    return { subject, text };
  }
  const subject = `Shift picked up: ${claimantName} took ${dropperName}'s shift`;
  const text = `${dropperName} dropped their shift on ${droppedShift.date} (${droppedShift.startTime}-${droppedShift.endTime}) via the Shift Marketplace, and ${claimantName} picked it up.\n\n`
    + `The roster has already been updated — this is an FYI, no action needed.`;
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

// Sent to ADMIN_NOTIFICATION_EMAIL whenever a booking is cancelled (any
// role, from the Bookings page) — separate from cancellationEmail above,
// which goes to the customer. Best-effort: a missing ADMIN_NOTIFICATION_EMAIL
// just skips silently, same as notifyAdminNewBooking.
async function notifyAdminBookingCancelled(booking, tableName) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!adminEmail) return;
  await sendEmail({
    to: adminEmail,
    subject: `Booking cancelled: ${booking.customerName} - ${booking.date} ${booking.time}`,
    text: `${booking.customerName} (${booking.phone || booking.email})'s booking for ${tableName || 'a table'} on ${booking.date} at ${booking.time} (party of ${booking.partySize}) was cancelled.`,
    type: 'admin-booking-cancelled',
    bookingId: booking.id
  });
}

// Sent to ADMIN_NOTIFICATION_EMAIL and every Senior Manager with an email
// on file, right after a Danger Zone factory reset completes — the account
// that triggered it may no longer exist afterwards, so this is the only
// record of who did it and when, besides the day's server log.
function factoryResetEmail(byName) {
  const subject = 'Factory reset completed';
  const text = `A factory reset was just completed on The Holy Cross booking app${byName ? ` by ${byName}` : ''}.\n\n`
    + `Every booking, timesheet, roster shift, request, and the table/room list were wiped back to the app's defaults, and a fresh admin account was (re)created from the ADMIN_EMAIL/ADMIN_PASSWORD in the app's environment settings.\n\n`
    + `If this wasn't expected, check with the team and change the admin password as soon as possible.`;
  return { subject, text };
}

async function notifyAdminAndSeniorManagersFactoryReset(byName) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  const seniorManagers = (await models.listUsers()).filter(u => u.role === 'senior_manager' && u.email);
  const recipients = new Set(seniorManagers.map(u => u.email));
  if (adminEmail) recipients.add(adminEmail);
  const { subject, text } = factoryResetEmail(byName);
  for (const to of recipients) {
    await sendEmail({ to, subject, text, type: 'factory-reset' });
  }
}

// Emails every Manager / Floor Manager / Senior Manager / General Manager /
// Admin who has an email on file — a Bar Staff booking hit a scheduling
// conflict and needs one of them to approve it before the customer hears
// anything.
async function notifyManagersPendingApproval(booking, table, conflict) {
  const managers = (await models.listUsers()).filter(u => MANAGER_ROLES.includes(u.role) && u.email);
  const { subject, text } = pendingApprovalEmail(booking, table, conflict);
  for (const m of managers) {
    await sendEmail({ to: m.email, subject, text, type: 'pending-approval', bookingId: booking.id });
  }
}

// Website booking approval SLA: every online booking request is meant to
// be actioned (approved, declined, or at minimum acknowledged) within 4
// hours of coming in. If it's still sitting in pending_approval, this
// escalates up the management hierarchy the longer it waits — Floor
// Manager first, then also Senior Manager, then also General Manager/
// Admin once the 4-hour SLA is actually breached — rather than a single
// reminder to everyone at once. Each tier only fires once per booking
// (tracked via bookings.escalation_tier / models.setEscalationTier), so
// re-running the sweep every 15 minutes doesn't re-notify a tier that
// already went out.
//
// Timing is a judgment call, not something Veera specified exactly: 1hr /
// 2.5hr / 4hr(SLA breach) tiers. Easy to retune — see ESCALATION_TIERS.
const ESCALATION_TIERS = [
  { tier: 1, afterMinutes: 60, roles: ['floor_manager'], label: 'first reminder (1hr)' },
  { tier: 2, afterMinutes: 150, roles: ['floor_manager', 'senior_manager'], label: 'second reminder (2.5hr)' },
  { tier: 3, afterMinutes: 240, roles: ['floor_manager', 'senior_manager', 'general_manager', 'admin'], label: 'SLA BREACHED (4hr+)' }
];

function bookingEscalationEmail(booking, table, tierInfo, minutesPending) {
  const hoursPending = (minutesPending / 60).toFixed(1);
  const overdue = tierInfo.tier === ESCALATION_TIERS.length;
  const subject = `${overdue ? 'OVERDUE — ' : 'Reminder: '}Booking request from ${booking.customerName} awaiting approval (${hoursPending}hr)`;
  const text = `A website booking request has been pending_approval for ${hoursPending} hours`
    + `${overdue ? ' — this has now passed the 4-hour approval SLA.' : '.'}\n\n`
    + `  - Customer: ${booking.customerName}\n`
    + `  - Party size: ${booking.partySize}\n`
    + `  - Date: ${booking.date} at ${booking.time}\n`
    + `  - Table/room: ${table ? table.name : 'none available for that party size'}\n`
    + `\nPlease review and approve, decline, or otherwise acknowledge booking #${booking.id} in the app under Bookings.`;
  return { subject, text };
}

// Runs every 15 minutes (see startScheduler below). For every booking
// still awaiting approval, works out how many minutes it's been pending
// and whether that's crossed into a new escalation tier since the last
// check; if so, emails that tier's roles and records the tier so it isn't
// re-sent next tick.
async function runBookingApprovalEscalationSweep() {
  const [pending, tables] = await Promise.all([
    models.listBookings({ status: 'pending_approval' }),
    models.listTables()
  ]);
  if (!pending.length) return;
  const now = Date.now();
  const users = await models.listUsers();
  for (const booking of pending) {
    if (!booking.createdAt) continue;
    const minutesPending = (now - new Date(booking.createdAt).getTime()) / 60000;
    // Highest tier whose threshold has been crossed.
    let dueTier = null;
    for (const t of ESCALATION_TIERS) {
      if (minutesPending >= t.afterMinutes) dueTier = t;
    }
    if (!dueTier || dueTier.tier <= (booking.escalationTier || 0)) continue;

    const table = tables.find(t => String(t.id) === String(booking.tableId));
    const { subject, text } = bookingEscalationEmail(booking, table, dueTier, minutesPending);
    const recipients = users.filter(u => dueTier.roles.includes(u.role) && u.email);
    for (const r of recipients) {
      await sendEmail({ to: r.email, subject, text, type: 'booking-approval-escalation', bookingId: booking.id });
    }
    await models.setEscalationTier(booking.id, dueTier.tier);
  }
}

// Every active staff account (not just Managers) gets told about a new
// public booking request — Bar/Kitchen Staff can see it on the Bookings
// page but can't approve it; only a Manager-tier account can.
async function notifyAllStaffNewPublicBooking(booking, table) {
  const staff = (await models.listUsers()).filter(u => u.active && u.role !== 'kiosk' && u.email);
  const { subject, text } = newPublicBookingRequestEmail(booking, table);
  for (const s of staff) {
    await sendEmail({ to: s.email, subject, text, type: 'public-booking-request', bookingId: booking.id });
  }
}

// Shift Marketplace — Managers only, email-only (matches every other
// manager-notification function in this file), fire-and-forget from the
// caller's perspective.
async function notifyManagersShiftChange(payload) {
  const managers = (await models.listUsers()).filter(u => MANAGER_ROLES.includes(u.role) && u.email);
  const { subject, text } = shiftChangeManagerEmail(payload);
  for (const m of managers) {
    await sendEmail({ to: m.email, subject, text, type: 'shift-marketplace' });
  }
}

// Kiosk "Forgot PIN?" — same manager audience as the booking-approval alert.
async function notifyManagersPinResetRequest(user) {
  const managers = (await models.listUsers()).filter(u => MANAGER_ROLES.includes(u.role) && u.email);
  const { subject, text } = pinResetRequestEmail(user);
  for (const m of managers) {
    await sendEmail({ to: m.email, subject, text, type: 'pin-reset-request' });
  }
}

// Duties escalation audience is narrower than the usual MANAGER_ROLES set —
// General Manager, Senior Manager, Floor Manager only (see duties.js).
async function notifyManagersDutyReport(report) {
  const recipients = (await models.listUsers()).filter(u => DUTY_ESCALATION_ROLES.includes(u.role) && u.email);
  const { subject, text } = dutyMissedEmail(report);
  for (const m of recipients) {
    await sendEmail({ to: m.email, subject, text, type: 'duty-missed' });
  }
}

// Stock Delivery & Recheck (Breakage & Stock page) — Floor Manager, Senior
// Manager, General Manager, and Admin get notified every time a delivery
// is logged (deliberately not Staff Manager/Accountant, per how this was
// requested).
const STOCK_DELIVERY_NOTIFY_ROLES = ['admin', 'senior_manager', 'general_manager', 'floor_manager'];

function stockDeliverySubmittedEmail(delivery) {
  const subject = `Stock delivery logged: ${delivery.itemName}`;
  const lines = [
    `A new stock delivery has been logged on the Breakage & Stock page.`,
    ``,
    `Item: ${delivery.itemName}`,
    `Category: ${delivery.categoryLabel}${delivery.subcategory ? ' (' + delivery.subcategory + ')' : ''}`,
    `Vendor: ${delivery.vendorName || 'not given'}`,
    `Quantity: ${delivery.quantity || 'not given'}`,
    `Delivery date: ${delivery.deliveryDate}`,
    `Stock matches invoice: ${delivery.matchesInvoice ? 'Yes' : 'No — discrepancy flagged, see notes'}`,
  ];
  if (delivery.notes) lines.push(`Notes: ${delivery.notes}`);
  lines.push(`Taken/verified by: ${delivery.submittedByName}`, ``, `View the invoice and stock photos on the Breakage & Stock page.`);
  return { subject, text: lines.join('\n') };
}

async function notifyManagersStockDelivery(delivery) {
  const recipients = (await models.listUsers()).filter(u => STOCK_DELIVERY_NOTIFY_ROLES.includes(u.role) && u.email);
  const { subject, text } = stockDeliverySubmittedEmail(delivery);
  for (const m of recipients) {
    await sendEmail({ to: m.email, subject, text, type: 'stock-delivery' });
  }
}

// Evaluates one duty section for one date and, if it's incomplete and
// hasn't already been reported, records + emails it. Shared by the fixed-
// window sweep, the lastClockout closing check, and the overnight safety
// net below — all three just disagree on *when* to call this.
// Weekly voucher reconciliation email — every voucher sold and every
// redemption made in the last 7 days, so the accountant team can check it
// against the physical voucher book. Recipients: anyone with the
// 'accountant' role or individually granted canManageVouchers, plus
// ADMIN_NOTIFICATION_EMAIL as a fallback if neither exists yet (so the
// email doesn't silently go nowhere before anyone's been set up).
function voucherWeeklySummaryEmail(sold, redemptions, periodLabel) {
  const subject = `Weekly voucher summary — ${periodLabel}`;
  const soldLines = sold.length
    ? sold.map(v => `  ${v.voucherNumber} — EUR ${v.faceValue.toFixed(2)} — sold by ${v.soldByName}${v.customerName ? ` — ${v.customerName}` : ''}`).join('\n')
    : '  (none)';
  const redeemedLines = redemptions.length
    ? redemptions.map(r => `  ${r.voucherNumber} — EUR ${r.amount.toFixed(2)} redeemed by ${r.redeemedByName}${r.note ? ` — ${r.note}` : ''}`).join('\n')
    : '  (none)';
  const soldTotal = sold.reduce((sum, v) => sum + v.faceValue, 0);
  const redeemedTotal = redemptions.reduce((sum, r) => sum + r.amount, 0);
  const text = `Voucher activity for ${periodLabel}:\n\n`
    + `VOUCHERS SOLD (${sold.length}, total EUR ${soldTotal.toFixed(2)}):\n${soldLines}\n\n`
    + `VOUCHERS REDEEMED (${redemptions.length}, total EUR ${redeemedTotal.toFixed(2)}):\n${redeemedLines}\n\n`
    + `Check the physical voucher book against this list — the full history is also in the app under Vouchers.`;
  return { subject, text };
}

async function notifyAccountantsWeeklyVoucherSummary() {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [sold, redemptions] = await Promise.all([
    models.listVouchersSoldBetween(start.toISOString(), now.toISOString()),
    models.listRedemptionsBetween(start.toISOString(), now.toISOString())
  ]);
  const periodLabel = `${start.toLocaleDateString()} – ${now.toLocaleDateString()}`;
  const { subject, text } = voucherWeeklySummaryEmail(sold, redemptions, periodLabel);
  const users = await models.listUsers();
  let recipients = users.filter(u => (u.role === 'accountant' || u.canManageVouchers) && u.email);
  if (!recipients.length && process.env.ADMIN_NOTIFICATION_EMAIL) {
    recipients = [{ email: process.env.ADMIN_NOTIFICATION_EMAIL }];
  }
  for (const r of recipients) {
    await sendEmail({ to: r.email, subject, text, type: 'voucher-weekly-summary' });
  }
}

async function evaluateAndReportDuty({ date, section, sectionTitle, trigger, fallbackReason }) {
  if (await models.getDutyReport(date, section)) return; // already handled today
  const checklist = await models.getDutiesChecklist(date);
  const sectionData = checklist.sections.find(s => s.key === section);
  if (!sectionData) return;
  const missing = sectionData.tasks.filter(t => !t.done);
  const { report, isNewIncomplete } = await models.recordDutyReport({
    date,
    section,
    sectionTitle: sectionTitle || sectionData.title,
    complete: missing.length === 0,
    reason: missing.length ? fallbackReason : '',
    missingTaskTexts: missing.map(t => t.text),
    staffOnShiftNames: await models.getBarStaffOnShiftNames(),
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
  const stillIn = await models.getBarStaffOnShiftNames();
  if (stillIn.length > 0) return; // not the last one out yet
  await evaluateAndReportDuty({
    date: toDateStr(win.businessDate),
    section: 'closing',
    sectionTitle: win.sectionTitle,
    trigger: 'auto-clockout',
    fallbackReason: '(not confirmed before clocking out)'
  });
}

// Checks for bookings starting within the reminder window and sends a
// reminder once. Bookings/tables moved to SQL in task #206 — this now goes
// through models.listBookings/listTables/setReminderSent instead of
// reaching into data/db.json directly (that array is permanently empty now
// that bookings.js no longer writes to it, so the old direct-readDb version
// would otherwise have silently stopped sending any reminders at all).
async function runReminderSweep() {
  const db = readDb();
  const hoursBefore = db.settings.reminderHoursBefore || 24;
  const now = new Date();
  const [bookings, tables] = await Promise.all([models.listBookings({ status: 'confirmed' }), models.listTables()]);
  for (const booking of bookings) {
    if (booking.reminderSent || (!booking.email && !booking.phone)) continue;
    const bookingDateTime = new Date(`${booking.date}T${booking.time}:00`);
    const hoursUntil = (bookingDateTime - now) / (1000 * 60 * 60);
    if (hoursUntil > 0 && hoursUntil <= hoursBefore) {
      // String-compare, not === : table.id is a SQL-sourced string
      // (INT8-backed SERIAL) while booking.tableId is a plain INT column —
      // same mismatch class fixed throughout this migration.
      const table = tables.find(t => String(t.id) === String(booking.tableId));
      if (booking.email) {
        const { subject, text } = bookingReminderEmail(booking, table);
        await sendEmail({ to: booking.email, subject, text, type: 'reminder', bookingId: booking.id });
      }
      if (booking.phone) {
        await sms.sendSms({ to: booking.phone, body: sms.bookingReminderSms(booking, table), type: 'reminder', bookingId: booking.id });
      }
      await models.setReminderSent(booking.id);
    }
  }
}

function startScheduler() {
  // Runs every 15 minutes to catch bookings entering the reminder window.
  cron.schedule('*/15 * * * *', () => {
    runReminderSweep().catch(err => console.error('Reminder sweep failed:', err.message));
  });
  console.log('Reminder scheduler started (checks every 15 minutes).');

  // Runs every 15 minutes to escalate any website booking request that's
  // sat in pending_approval too long — see ESCALATION_TIERS above.
  cron.schedule('*/15 * * * *', () => {
    runBookingApprovalEscalationSweep().catch(err => console.error('Booking approval escalation sweep failed:', err.message));
  });
  console.log('Booking approval escalation sweep started (checks every 15 minutes).');

  // Runs every 5 minutes to catch duty windows nobody confirmed on the
  // kiosk (fixed-time windows), plus the overnight safety net for
  // Closing's lastClockout windows.
  cron.schedule('*/5 * * * *', () => {
    runDutyWindowSweep().catch(err => console.error('Duty window sweep failed:', err.message));
  });
  console.log('Duty window sweep started (checks every 5 minutes).');

  // Every Monday at 7am — last 7 days of voucher sales/redemptions, emailed
  // to the accountant team for reconciliation against the physical voucher
  // book. See notifyAccountantsWeeklyVoucherSummary above.
  cron.schedule('0 7 * * 1', () => {
    notifyAccountantsWeeklyVoucherSummary().catch(err => console.error('Weekly voucher summary failed:', err.message));
  });
  console.log('Weekly voucher summary scheduler started (Mondays at 7am).');
}

module.exports = {
  sendEmail, fromAddressForType, bookingConfirmationEmail, bookingIcsAttachment, bookingReminderEmail, cancellationEmail,
  shiftAssignedEmail, shiftUpdatedEmail, newRequestEmail, pendingApprovalEmail,
  passwordResetEmail, pinResetRequestEmail, dutyMissedEmail, reportSubmittedEmail, staffWelcomeEmail,
  publicBookingReceivedEmail, newPublicBookingRequestEmail, cashSafeLogEmail,
  shiftDropPickedUpEmail, shiftClaimedEmail, shiftExchangeEmail, shiftChangeManagerEmail,
  selfVerificationCodeEmail,
  notifyAdminNewBooking, notifyAdminBookingCancelled, notifyManagersPendingApproval, notifyManagersPinResetRequest,
  notifyManagersDutyReport, notifyAllStaffNewPublicBooking, notifySeniorManagerCashLog,
  notifyManagersShiftChange, factoryResetEmail, notifyAdminAndSeniorManagersFactoryReset,
  voucherWeeklySummaryEmail, notifyAccountantsWeeklyVoucherSummary,
  stockDeliverySubmittedEmail, notifyManagersStockDelivery,
  bookingEscalationEmail, runBookingApprovalEscalationSweep, ESCALATION_TIERS,
  runDutyWindowSweep, checkClosingDutiesOnClockOut,
  runReminderSweep, startScheduler, getTransporter, CONTACT_PHONE
};
