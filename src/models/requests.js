// Requests (staff -> staff/manager: stock, leave, other). Deliberately
// minimal first pass: pick a type, pick a specific recipient, write what
// you need — the recipient gets an email + text right away. Status
// tracking / approve-decline workflow can be layered on later.
const { readDb, writeDb } = require('../db');

const REQUEST_TYPES = [
  { value: 'stock', label: 'Stock' },
  { value: 'leave', label: 'Leave' },
  { value: 'other', label: 'Other' }
];
const REQUEST_TYPE_LABELS = Object.fromEntries(REQUEST_TYPES.map(t => [t.value, t.label]));

function createRequest({ type, details, requestedByUserId, recipientUserId }) {
  const db = readDb();
  if (!db.requests) db.requests = [];
  if (!db.meta.nextRequestId) db.meta.nextRequestId = 1;
  const requester = (db.users || []).find(u => u.id === Number(requestedByUserId));
  const recipient = (db.users || []).find(u => u.id === Number(recipientUserId));
  if (!recipient) return { error: 'Recipient not found.' };
  if (requester && requester.id === recipient.id) return { error: "You can't send a request to yourself." };
  const request = {
    id: db.meta.nextRequestId++,
    type,
    typeLabel: REQUEST_TYPE_LABELS[type] || 'Other',
    details: details || '',
    requestedByUserId: requester ? requester.id : Number(requestedByUserId),
    requestedByName: requester ? requester.name : 'Unknown',
    recipientUserId: recipient.id,
    recipientName: recipient.name,
    status: 'sent',
    createdAt: new Date().toISOString()
  };
  db.requests.push(request);
  writeDb(db);
  return { request: { ...request, recipient } };
}

// Requests you've sent and requests sent to you, newest first.
function listRequestsForUser(userId) {
  const db = readDb();
  const uid = Number(userId);
  const all = (db.requests || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    sent: all.filter(r => r.requestedByUserId === uid),
    received: all.filter(r => r.recipientUserId === uid)
  };
}

// Every request ever sent, newest first — used by the manager-facing Logs
// page (src/routes/logs.js), same reasoning as staffReports.listAllReports.
function listAllRequests() {
  const db = readDb();
  return (db.requests || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { REQUEST_TYPES, createRequest, listRequestsForUser, listAllRequests };
