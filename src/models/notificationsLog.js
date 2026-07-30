// The Notifications page's audit log — every email/SMS the app has
// attempted, sent or failed. Distinct from src/notify.js, which is the
// thing that actually sends messages; this just records what happened.
const { readDb, writeDb } = require('../db');

function logNotification({ type, bookingId, recipient, subject, text, status, error }) {
  const db = readDb();
  db.notifications.unshift({
    id: db.meta.nextNotificationId++,
    type,
    bookingId,
    recipient,
    subject,
    text: text || null,
    status,
    error: error || null,
    sentAt: new Date().toISOString()
  });
  db.notifications = db.notifications.slice(0, 500);
  writeDb(db);
}
function listNotifications(limit = 100) {
  return readDb().notifications.slice(0, limit);
}
function getNotification(id) {
  return readDb().notifications.find(n => n.id === Number(id));
}

module.exports = { logNotification, listNotifications, getNotification };
