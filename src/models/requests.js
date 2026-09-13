// Requests (staff -> staff/manager: stock, leave, other). Deliberately
// minimal first pass: pick a type, pick a specific recipient, write what
// you need — the recipient gets an email + text right away. Status
// tracking / approve-decline workflow can be layered on later.
// SQL-backed as of task #208 — the existing `requests` table just needed
// recipient_user_id/recipient_name columns added (see
// db/011_redesign_cash_safe_requests_reports_shiftdrops.sql). Every
// exported function is now ASYNC.
const { query } = require('../sqlPool');
const { getUserById } = require('./users');

const REQUEST_TYPES = [
  { value: 'stock', label: 'Stock' },
  { value: 'leave', label: 'Leave' },
  { value: 'other', label: 'Other' }
];
const REQUEST_TYPE_LABELS = Object.fromEntries(REQUEST_TYPES.map(t => [t.value, t.label]));

function mapRequestRow(r) {
  return {
    id: r.id,
    type: r.type,
    typeLabel: r.type_label,
    details: r.details,
    requestedByUserId: r.requested_by,
    requestedByName: r.requested_by_name,
    recipientUserId: r.recipient_user_id,
    recipientName: r.recipient_name,
    status: r.status,
    createdAt: r.created_at
  };
}

async function createRequest({ type, details, requestedByUserId, recipientUserId }) {
  const requester = await getUserById(requestedByUserId);
  const recipient = await getUserById(recipientUserId);
  if (!recipient) return { error: 'Recipient not found.' };
  if (requester && requester.id === recipient.id) return { error: "You can't send a request to yourself." };

  const { rows } = await query(
    `INSERT INTO requests (type, type_label, details, requested_by, requested_by_name, recipient_user_id, recipient_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      type,
      REQUEST_TYPE_LABELS[type] || 'Other',
      details || '',
      requester ? requester.id : Number(requestedByUserId),
      requester ? requester.name : 'Unknown',
      recipient.id,
      recipient.name
    ]
  );
  return { request: { ...mapRequestRow(rows[0]), recipient } };
}

// Requests you've sent and requests sent to you, newest first.
async function listRequestsForUser(userId) {
  const uid = Number(userId);
  const { rows } = await query(
    `SELECT * FROM requests WHERE requested_by = $1 OR recipient_user_id = $1 ORDER BY created_at DESC`,
    [uid]
  );
  const all = rows.map(mapRequestRow);
  return {
    sent: all.filter(r => r.requestedByUserId === uid),
    received: all.filter(r => r.recipientUserId === uid)
  };
}

// Every request ever sent, newest first — used by the manager-facing Logs
// page (src/routes/logs.js), same reasoning as staffReports.listAllReports.
async function listAllRequests() {
  const { rows } = await query(`SELECT * FROM requests ORDER BY created_at DESC`);
  return rows.map(mapRequestRow);
}

module.exports = { REQUEST_TYPES, createRequest, listRequestsForUser, listAllRequests };
