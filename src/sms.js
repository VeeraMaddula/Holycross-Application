// SMS notifications via Sendmode's REST API, using only Node's built-in
// fetch (no SDK dependency needed) — same philosophy as googleCalendar.js.
// API reference: https://developers.sendmode.com/restdocs/send
const models = require('./models');
const { normalizePhone } = require('./phoneUtils');

const SENDMODE_API_URL = 'https://rest.sendmode.com/v2/send';

// Only the access key is strictly required — senderid is optional on
// Sendmode's side (it falls back to your account default if omitted), but
// setting SENDMODE_SENDER_ID is what lets texts show up as "HolyCross"
// instead of a generic number. That needs a one-time ComReg registration
// (a few days) — see README "SMS via Sendmode" for the how-to.
function isConfigured() {
  return !!process.env.SENDMODE_API_KEY;
}

async function sendSms({ to, body, type, bookingId }) {
  const recipient = normalizePhone(to);
  if (!recipient) return;

  if (!isConfigured()) {
    models.logNotification({ type: `${type}-sms`, bookingId, recipient, subject: body.slice(0, 60), text: body, status: 'skipped-no-sendmode' });
    return;
  }

  const { SENDMODE_API_KEY, SENDMODE_SENDER_ID } = process.env;
  const message = {
    messagetext: body,
    recipients: [recipient]
  };
  if (SENDMODE_SENDER_ID) message.senderid = SENDMODE_SENDER_ID;
  // A per-message reference — shows up on Sendmode's delivery reports/
  // dashboard, handy for matching a report back to a booking while
  // troubleshooting, without changing anything about how the SMS itself sends.
  if (bookingId) message.customerid = String(bookingId);

  try {
    const res = await fetch(SENDMODE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: SENDMODE_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ message: JSON.stringify(message) })
    });
    const data = await res.json().catch(() => ({}));
    // Sendmode always replies 200 OK at the HTTP level and signals success/
    // failure via the JSON body instead (statusCode 0 = accepted; anything
    // else is an error — see https://developers.sendmode.com/restdocs/errors).
    if (!res.ok || data.statusCode !== 0) {
      throw new Error((data && (data.error || data.status)) || `Sendmode error (HTTP ${res.status})`);
    }
    models.logNotification({ type: `${type}-sms`, bookingId, recipient, subject: body.slice(0, 60), text: body, status: 'sent' });
  } catch (err) {
    models.logNotification({ type: `${type}-sms`, bookingId, recipient, subject: body.slice(0, 60), text: body, status: 'failed', error: err.message });
  }
}

// Never names the specific table — that's an internal seating detail — but
// does name the room for a Function Room booking, since the customer chose
// that on purpose.
function roomSuffix(table) {
  return (table && table.area === 'Function Room') ? ` (${table.name})` : '';
}

function bookingConfirmationSms(booking, table) {
  return `The Holy Cross: Booking confirmed for ${booking.partySize} on ${booking.date} at ${booking.time}${roomSuffix(table)}. We'll be in touch nearer the time - info: +353 51 353087. See you soon!`;
}
function bookingReminderSms(booking, table) {
  return `The Holy Cross: Reminder - your booking for ${booking.partySize} is on ${booking.date} at ${booking.time}${roomSuffix(table)}. Info: +353 51 353087.`;
}
function cancellationSms(booking) {
  return `The Holy Cross: Your booking for ${booking.date} at ${booking.time} has been cancelled. Contact us on +353 51 353087 if this wasn't expected.`;
}

function shiftAssignedSms(shift) {
  return `The Holy Cross: New shift on ${shift.date} from ${shift.startTime} to ${shift.endTime}.`;
}
function shiftUpdatedSms(shift) {
  return `The Holy Cross: Your shift on ${shift.date} was updated - now ${shift.startTime} to ${shift.endTime}.`;
}

function newRequestSms(request) {
  const preview = (request.details || '').slice(0, 80);
  return `The Holy Cross: New ${request.typeLabel} request from ${request.requestedByName} - "${preview}". Check the app.`;
}

module.exports = {
  isConfigured, sendSms, normalizePhone, bookingConfirmationSms, bookingReminderSms, cancellationSms,
  shiftAssignedSms, shiftUpdatedSms, newRequestSms
};
