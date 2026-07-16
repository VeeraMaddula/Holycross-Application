// SMS notifications via Twilio's REST API, using only Node's built-in fetch
// (no twilio SDK dependency needed) — same philosophy as googleCalendar.js.
const models = require('./models');
const { normalizePhone } = require('./phoneUtils');

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

async function sendSms({ to, body, type, bookingId }) {
  const recipient = normalizePhone(to);
  if (!recipient) return;

  if (!isConfigured()) {
    models.logNotification({ type: `${type}-sms`, bookingId, recipient, subject: body.slice(0, 60), text: body, status: 'skipped-no-twilio' });
    return;
  }

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: recipient, From: TWILIO_PHONE_NUMBER, Body: body })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data && data.message) || `Twilio error ${res.status}`);
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
