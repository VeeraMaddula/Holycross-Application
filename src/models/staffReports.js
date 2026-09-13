// Staff Reports ("Report an Issue"): a one-way, one-to-one channel — any
// non-Kiosk staff member can file a report about a colleague/situation,
// addressed to one specific management-tier person. Deliberately never
// surfaced to the person being reported about — same spirit as an HR
// complaint, not a public log.
// SQL-backed as of task #208 — see
// db/011_redesign_cash_safe_requests_reports_shiftdrops.sql. Every exported
// function is now ASYNC.
const { query } = require('../sqlPool');
const { getUserById } = require('./users');

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

function mapReportRow(r) {
  return {
    id: r.id,
    category: r.category,
    categoryLabel: r.category_label,
    details: r.details,
    files: r.files || [],
    reportedByUserId: r.reported_by_user_id,
    reportedByName: r.reported_by_name,
    recipientUserId: r.recipient_user_id,
    recipientName: r.recipient_name,
    status: r.status,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at
  };
}

async function createReport({ category, details, files, reportedByUserId, recipientUserId }) {
  const reporter = await getUserById(reportedByUserId);
  const recipient = await getUserById(recipientUserId);
  if (!recipient) return { error: 'Recipient not found.' };
  if (reporter && reporter.id === recipient.id) return { error: "You can't send a report to yourself." };

  const { rows } = await query(
    `INSERT INTO reports (category, category_label, details, files, reported_by_user_id, reported_by_name, recipient_user_id, recipient_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      category,
      REPORT_CATEGORY_LABELS[category] || 'Other',
      details || '',
      JSON.stringify(files || []),
      reporter ? reporter.id : Number(reportedByUserId),
      reporter ? reporter.name : 'Unknown',
      recipient.id,
      recipient.name
    ]
  );
  return { report: { ...mapReportRow(rows[0]), recipient } };
}

// Reports you've filed and reports sent to you, newest first — same shape
// as listRequestsForUser.
async function listReportsForUser(userId) {
  const uid = Number(userId);
  const { rows } = await query(
    `SELECT * FROM reports WHERE reported_by_user_id = $1 OR recipient_user_id = $1 ORDER BY created_at DESC`,
    [uid]
  );
  const all = rows.map(mapReportRow);
  return {
    sent: all.filter(r => r.reportedByUserId === uid),
    received: all.filter(r => r.recipientUserId === uid)
  };
}

async function getReport(id) {
  const { rows } = await query(`SELECT * FROM reports WHERE id = $1`, [Number(id)]);
  return rows[0] ? mapReportRow(rows[0]) : null;
}

// Every report ever filed, newest first — used by the manager-facing Logs
// page (src/routes/logs.js). Unlike listReportsForUser, this ignores who
// filed/received each one; access to the Logs page itself is what keeps
// this from being open to just anyone.
async function listAllReports() {
  const { rows } = await query(`SELECT * FROM reports ORDER BY created_at DESC`);
  return rows.map(mapReportRow);
}

// Only the recipient can mark their own report reviewed — lets them track
// what they've already dealt with without changing anything the reporter sees.
async function markReportReviewed(id, reviewerUserId) {
  const r = await getReport(id);
  if (!r) return { error: 'Report not found.' };
  if (r.recipientUserId !== Number(reviewerUserId)) return { error: 'Only the recipient can mark this reviewed.' };
  const { rows } = await query(
    `UPDATE reports SET status = 'reviewed', reviewed_at = now() WHERE id = $1 RETURNING *`,
    [Number(id)]
  );
  return { report: mapReportRow(rows[0]) };
}

module.exports = { REPORT_CATEGORIES, createReport, listReportsForUser, getReport, markReportReviewed, listAllReports };
