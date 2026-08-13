// SMS notifications via Sendmode's current "Engage" REST API (sms-rest 3.0).
// API reference: https://engage.sendmode.com/apireference/#/send
//
// HISTORY — read this before touching the endpoint again: this file
// originally pointed at sms-rest.sendmode.dev/3.0/send, which was correct.
// Partway through troubleshooting delivery, a wrong diagnosis (based on a
// DNS failure that turned out to be this sandbox's own broken network, not
// a real problem with Sendmode's host) led to "fixing" it to
// rest.sendmode.com/v2/send instead. That v2 host is a legacy/deprecated
// system: it accepts any request and always replies with a fake
// "statusCode: 0" success, but never actually queues or delivers anything,
// and NOTHING sent through it appears anywhere in Sendmode's own account —
// not the Sent SMS report, not the credit balance. CONFIRMED directly by
// Sendmode support (Michael Tourish, 2026-08-12): "the /v2 API is for a
// historical system, not the API your account is on... I see no record of
// any requests coming in" for everything sent via v2. Every "sent"
// notification logged during that period was never actually delivered —
// it just looked like it worked. Reverted back to the correct v3 endpoint
// below; do not change this without a live confirmed test AND without
// checking Sendmode's own Sent SMS report shows the send.
const models = require('./models');
const { normalizePhone } = require('./phoneUtils');

const SENDMODE_API_URL = 'https://sms-rest.sendmode.dev/3.0/send';

// sender_id is a REQUIRED field on every v3 request (max 15 chars,
// alphanumeric). "HolyCross" was never actually submitted to Sendmode for
// ComReg approval (CONFIRMED with Sendmode support, 2026-08-12 — they have
// no record of any request for it), so it's currently unauthorised and
// every send with it gets rejected. Sendmode is submitting the ComReg
// request now on our behalf. Set via SENDMODE_SENDER_ID in .env / Render —
// this hardcoded default is only what's used if that env var is left
// blank, and should be swapped for a confirmed-working sender ID once one
// exists (test with `node test-sendmode.js` and check Sendmode's own Sent
// SMS report shows a Delivered status before trusting any sender ID here).
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
    // Sendmode's v3 docs — normalizePhone() already gives us exactly that,
    // no extra conversion needed (unlike the old, incorrect v2 integration).
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
