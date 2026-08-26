// Staff Reports ("Report an Issue"): a one-way, one-to-one channel — any
// non-Kiosk staff member can file a report about a colleague/situation,
// addressed to one specific management-tier person. Deliberately never
// surfaced to the person being reported about — same spirit as an HR
// complaint, not a public log.
const { readDb, writeDb } = require('../db');
const { getUserById } = require('./users');
// NOTE: reports themselves are still JSON (this file's own turn in the
// migration hasn't happened yet); only the user lookups are async SQL now.

const REPORT_CATEGORIES = [
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'misbehavior', label: 'Misbehavior' },
  { value: 'not_working', label: 'Not Working' },
  { value: 'lazy', label: 'Lazy' },
  { value: 'arrogant', label: 'Arrogant' },
  { value: 'misleading', label: 'Misleading Others' },
  { value: 'other', label: 'Other' }
];
const REPORT_CATEGORY_LABELS = Object.fromEntries(REPORT_CATEGORIES.map(c => [c.value, c.label]));

async function createReport({ category, details, files, reportedByUserId, recipientUserId }) {
  const db = readDb();
  if (!db.reports) db.reports = [];
  if (!db.meta.nextReportId) db.meta.nextReportId = 1;
  const reporter = await getUserById(reportedByUserId);
  const recipient = await getUserById(recipientUserId);
  if (!recipient) return { error: 'Recipient not found.' };
  if (reporter && reporter.id === recipient.id) return { error: "You can't send a report to yourself." };
  const report = {
    id: db.meta.nextReportId++,
    category,
    categoryLabel: REPORT_CATEGORY_LABELS[category] || 'Other',
    details: details || '',
    files: files || [],
    reportedByUserId: reporter ? reporter.id : Number(reportedByUserId),
    reportedByName: reporter ? reporter.name : 'Unknown',
    recipientUserId: recipient.id,
    recipientName: recipient.name,
    status: 'sent',
    createdAt: new Date().toISOString()
  };
  db.reports.push(report);
  writeDb(db);
  return { report: { ...report, recipient } };
}

// Reports you've filed and reports sent to you, newest first — same shape
// as listRequestsForUser.
function listReportsForUser(userId) {
  const db = readDb();
  const uid = Number(userId);
  const all = (db.reports || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    sent: all.filter(r => r.reportedByUserId === uid),
    received: all.filter(r => r.recipientUserId === uid)
  };
}

function getReport(id) {
  const db = readDb();
  return (db.reports || []).find(r => r.id === Number(id)) || null;
}

// Every report ever filed, newest first — used by the manager-facing Logs
// page (src/routes/logs.js). Unlike listReportsForUser, this ignores who
// filed/received each one; access to the Logs page itself is what keeps
// this from being open to just anyone.
function listAllReports() {
  const db = readDb();
  return (db.reports || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Only the recipient can mark their own report reviewed — lets them track
// what they've already dealt with without changing anything the reporter sees.
function markReportReviewed(id, reviewerUserId) {
  const db = readDb();
  const r = (db.reports || []).find(x => x.id === Number(id));
  if (!r) return { error: 'Report not found.' };
  if (r.recipientUserId !== Number(reviewerUserId)) return { error: 'Only the recipient can mark this reviewed.' };
  r.status = 'reviewed';
  r.reviewedAt = new Date().toISOString();
  writeDb(db);
  return { report: r };
}

module.exports = { REPORT_CATEGORIES, createReport, listReportsForUser, getReport, markReportReviewed, listAllReports };
