// SMS notifications via Sendmode's REST API.
// Official docs: https://developers.sendmode.com/restdocs/send
//
// HISTORY: a previous version of this file pointed at
// sms-rest.sendmode.dev/3.0/send, based on a one-off endpoint mentioned by
// a Sendmode support rep. That host doesn't actually resolve in DNS at all
// (confirmed: every send attempt through it failed with a raw "fetch
// failed" network error, never even reaching Sendmode) — so it's been
// reverted back to the one Sendmode's own public developer docs describe:
// rest.sendmode.com/v2/send. This host is live and responds correctly.
//
// Separately — and this matters more than the endpoint — Sendmode's own
// dashboard (Reports > API Usage) showed earlier send attempts WERE
// reaching Sendmode and consuming credit, but landing at 0% delivered.
// That pattern (accepted + billed, never delivered) is the classic
// signature of an unregistered alphanumeric sender ID being silently
// dropped by carriers — see the SENDMODE_SENDER_ID note below and the
// README "SMS via Sendmode" section (ComReg approval step). Fixing the
// endpoint alone will NOT fix that — it needs checking on the Sendmode
// account side.
const models = require('./models');
const { normalizePhone } = require('./phoneUtils');

const SENDMODE_API_URL = 'https://rest.sendmode.com/v2/send';

// A registered alpha sender ID is optional per Sendmode's API (omit it and
// their default is used), but an UNREGISTERED one (no ComReg approval) can
// be silently accepted by the API and then dropped by carriers with no
// error surfaced anywhere — see the history note above. Register the real
// one via the Sendmode dashboard before relying on this for real customer
// texts (see README "SMS via Sendmode").
const DEFAULT_SENDER_ID = 'HolyCross';

function isConfigured() {
  return !!process.env.SENDMODE_API_KEY;
}

// Sendmode's own documented example payload (developers.sendmode.com/
// restdocs/send) shows recipients in plain LOCAL format — "0870000000" —
// not international E.164 ("+353870000000"), which is what normalizePhone()
// produces and what every other part of this app uses (login matching,
// storage, display). Sending the wrong shape wouldn't necessarily get
// rejected outright by the API — it could easily be accepted, billed, and
// then silently fail to route, which matches what was observed in testing.
// Converting only at the point of calling Sendmode, so nothing else in the
// app changes.
function toSendmodeRecipientFormat(e164) {
  if (e164.startsWith('+353')) return '0' + e164.slice(4);
  // Non-Irish number: Sendmode's docs don't show an international example,
  // but "no + prefix" is the far more common convention for gateways that
  // expect local-style formatting — strip it rather than sending something
  // that contradicts their one documented example.
  if (e164.startsWith('+')) return e164.slice(1);
  return e164;
}

async function sendSms({ to, body, type, bookingId }) {
  const recipient = normalizePhone(to);
  if (!recipient) return;

  if (!isConfigured()) {
    models.logNotification({ type: `${type}-sms`, bookingId, recipient, subject: body.slice(0, 60), text: body, status: 'skipped-no-sendmode' });
    return;
  }

  const { SENDMODE_API_KEY, SENDMODE_SENDER_ID } = process.env;
  // v2's "message" parameter is itself a JSON-encoded string, wrapped in a
  // form-urlencoded POST body — not a plain JSON body. recipients is an
  // array even for a single number. See developers.sendmode.com/restdocs/send.
  const messageJson = {
    messagetext: body,
    senderid: SENDMODE_SENDER_ID || DEFAULT_SENDER_ID,
    recipients: [toSendmodeRecipientFormat(recipient)]
  };
  // A per-message reference — comes back in delivery reports, handy for
  // matching a report back to a booking while troubleshooting.
  if (bookingId) messageJson.customerid = String(bookingId);

  try {
    const res = await fetch(SENDMODE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: SENDMODE_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ message: JSON.stringify(messageJson) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.statusCode !== 0) {
      throw new Error((data && data.error) || (data && data.status) || `Sendmode error (HTTP ${res.status})`);
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
