// SMS notifications via Sendmode's current "Engage" REST API (sms-rest 3.0).
// API reference: https://engage.sendmode.com/apireference/#/send
//
// IMPORTANT: an earlier version of this file integrated against
// https://rest.sendmode.com/v2/send, documented at
// developers.sendmode.com/restdocs/send. That turned out to be a legacy/
// deprecated endpoint — it accepts requests and always replies with a fake
// "statusCode: 0" success, but never actually queues or delivers anything
// (confirmed live: messages never arrived, never appeared in Sendmode's own
// Sent SMS report, and account credit balance never moved, across ~10 send
// attempts). Sendmode support (Trevor Dougherty) flagged that we were on
// old documentation. The correct, current API lives at
// sms-rest.sendmode.dev/3.0/send — different host, different auth style
// (still a raw Authorization header, but JSON body instead of a
// form-urlencoded "message" field), different field names, and a different
// success shape (`is_successful: true` instead of `statusCode: 0`).
const models = require('./models');
const { normalizePhone } = require('./phoneUtils');

const SENDMODE_API_URL = 'https://sms-rest.sendmode.dev/3.0/send';

// Unlike the old API, sender_id is a REQUIRED field on every request (max
// 15 chars, alphanumeric). If SENDMODE_SENDER_ID isn't set in .env yet, we
// fall back to "HolyCross" so sends don't fail outright — but an
// unregistered alpha sender ID can still be rejected by some carriers, so
// registering the real one (see README "SMS via Sendmode") is worth doing
// once you're past initial testing.
const DEFAULT_SENDER_ID = 'HolyCross';

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
  const payload = {
    sender_id: SENDMODE_SENDER_ID || DEFAULT_SENDER_ID,
    message: body,
    // mobile_number wants international format (e.g. "+353871234567") per
    // Sendmode's docs — normalizePhone() already gives us exactly that.
    mobile_number: recipient
  };
  // A per-message reference — comes back in webhook callbacks/delivery
  // reports, handy for matching a report back to a booking while
  // troubleshooting, without changing anything about how the SMS sends.
  if (bookingId) payload.customer_id = String(bookingId);

  try {
    const res = await fetch(SENDMODE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: SENDMODE_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.is_successful !== true) {
      throw new Error((data && data.error_message) || `Sendmode error (HTTP ${res.status})`);
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

// Shift Marketplace — sent to the original owner when someone else picks
// up (no swap) the shift they dropped.
function shiftDropPickedUpSms(shift, pickedUpByName) {
  return `The Holy Cross: ${pickedUpByName} picked up your dropped shift on ${shift.date} (${shift.startTime}-${shift.endTime}). It's off your schedule now.`;
}

// Shift Marketplace — sent to whoever just picked up a dropped shift.
function shiftClaimedSms(shift) {
  return `The Holy Cross: You picked up the shift on ${shift.date}, ${shift.startTime}-${shift.endTime}. Check My Shifts.`;
}

// Shift Marketplace — sent to each party of an exchange, about their own
// new shift.
function shiftExchangeSms(newShift, oldDate) {
  return `The Holy Cross: Shift exchanged - you're now on ${newShift.date} from ${newShift.startTime} to ${newShift.endTime}, instead of ${oldDate}.`;
}

module.exports = {
  isConfigured, sendSms, normalizePhone, bookingConfirmationSms, bookingReminderSms, cancellationSms,
  shiftAssignedSms, shiftUpdatedSms, newRequestSms,
  shiftDropPickedUpSms, shiftClaimedSms, shiftExchangeSms
};
