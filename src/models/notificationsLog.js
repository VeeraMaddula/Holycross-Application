// The Notifications page's audit log — every email/SMS the app has
// attempted, sent or failed. Distinct from src/notify.js, which is the
// thing that actually sends messages; this just records what happened.
// SQL-backed as of task #209 — the existing `notifications` table's shape
// already matched exactly, so only this model file needed rewriting.
// logNotification is called extremely often (every single email/SMS
// attempt across the whole app) and none of its callers await it, so it's
// kept fire-and-forget here too — errors are logged, never thrown, so a
// notification-logging hiccup can never break the send it's recording.
const { query } = require('../sqlPool');

function mapRow(r) {
  return {
    id: r.id,
    type: r.type,
    bookingId: r.booking_id,
    recipient: r.recipient,
    subject: r.subject,
    text: r.text,
    status: r.status,
    error: r.error,
    sentAt: r.sent_at
  };
}

function logNotification({ type, bookingId, recipient, subject, text, status, error }) {
  query(
    `INSERT INTO notifications (type, booking_id, recipient, subject, text, status, error) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [type, bookingId || null, recipient, subject, text || null, status, error || null]
  ).catch(err => console.error('logNotification failed:', err.message));
}

async function listNotifications(limit = 100) {
  const { rows } = await query(`SELECT * FROM notifications ORDER BY sent_at DESC LIMIT $1`, [limit]);
  return rows.map(mapRow);
}

async function getNotification(id) {
  const { rows } = await query(`SELECT * FROM notifications WHERE id = $1`, [Number(id)]);
  return rows[0] ? mapRow(rows[0]) : undefined;
}

module.exports = { logNotification, listNotifications, getNotification };
