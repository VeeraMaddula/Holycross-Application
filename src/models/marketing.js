// Marketing / Design requests — a queue where Admin and managers ask for a
// poster/menu/social post, and an AI design agent (running outside this app,
// in a Claude session with the OpenArt image-generation MCP connector — see
// the separate `agent-workspace` repo for its brief/branding rules) picks up
// the request, generates the design, and posts the finished image back here.
//
// Why a queue instead of a live "click and get an image" button: OpenArt
// doesn't expose a normal server-callable REST API — it's only reachable
// from inside an AI agent session (MCP/OAuth). So this app can't call an
// image API directly the way it calls Resend for email or Sendmode for SMS.
// Instead, requests sit here as `pending` until a scheduled agent run polls
// the token-protected API below (see src/routes/marketing.js), generates the
// design, and calls back in with the result. Turnaround is "next scheduled
// run", not instant.
const { readDb, writeDb } = require('../db');

const CATEGORIES = [
  { value: 'monday_specials', label: 'Monday Specials' },
  { value: 'function_specials', label: 'Function Specials' },
  { value: 'game_night', label: 'Game Night Offers' },
  { value: 'chef_specials', label: 'Chef Specials' },
  { value: 'custom', label: 'Custom' }
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));

// pending        — waiting for the agent to pick it up
// in_progress     — agent has claimed it and is working on it
// needs_info      — agent asked a clarifying question, waiting on the requester
// ready           — a design has been delivered (may still get revision replies)
const STATUSES = ['pending', 'in_progress', 'needs_info', 'ready'];
const STATUS_LABELS = {
  pending: 'Waiting for agent',
  in_progress: 'In progress',
  needs_info: 'Needs your reply',
  ready: 'Ready'
};

function listMarketingRequests() {
  const db = readDb();
  return (db.marketingRequests || []).slice().sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
}

function getMarketingRequest(id) {
  const db = readDb();
  return (db.marketingRequests || []).find(r => r.id === Number(id)) || null;
}

// What the agent polls — anything currently waiting on it, oldest first so
// requests are worked in the order they came in.
function listPendingMarketingRequests() {
  const db = readDb();
  return (db.marketingRequests || [])
    .filter(r => r.status === 'pending')
    .sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));
}

function createMarketingRequest({ title, category, brief, attachments, requestedByUserId, requestedByName }) {
  const db = readDb();
  if (!db.marketingRequests) db.marketingRequests = [];
  if (!db.meta.nextMarketingRequestId) db.meta.nextMarketingRequestId = 1;
  const id = db.meta.nextMarketingRequestId++;
  const request = {
    id,
    title: (title || '').trim(),
    category: CATEGORY_LABELS[category] ? category : 'custom',
    brief: (brief || '').trim(),
    attachments: attachments || [],
    requestedByUserId: Number(requestedByUserId),
    requestedByName: requestedByName || 'Unknown',
    requestedAt: new Date().toISOString(),
    status: 'pending',
    thread: [],
    resultImageUrl: '',
    resultImagePath: '',
    deliveredAt: null,
    revisionCount: 0
  };
  db.marketingRequests.push(request);
  writeDb(db);
  return request;
}

function addThreadMessage(db, request, { from, text }) {
  request.thread.push({ from, text: (text || '').trim(), at: new Date().toISOString() });
}

// The agent claiming a request off the queue, so two scheduled runs don't
// both start working the same one.
function claimMarketingRequest(id) {
  const db = readDb();
  const r = (db.marketingRequests || []).find(x => x.id === Number(id));
  if (!r) return { error: 'Request not found.' };
  if (r.status !== 'pending') return { error: `Request is already "${r.status}", not pending.` };
  r.status = 'in_progress';
  writeDb(db);
  return { request: r };
}

// Agent has a clarifying question before it can start/continue.
function markMarketingNeedsInfo(id, question) {
  const db = readDb();
  const r = (db.marketingRequests || []).find(x => x.id === Number(id));
  if (!r) return { error: 'Request not found.' };
  r.status = 'needs_info';
  addThreadMessage(db, r, { from: 'agent', text: question });
  writeDb(db);
  return { request: r };
}

// Any manager with Marketing access replying — either answering a
// needs_info question, or leaving a revision note on a request that's
// already ready. This is a shared team queue (unlike the private 1:1 Report
// an Issue channel), so it's deliberately not restricted to the original
// requester — any manager who can see the queue can follow up on it. Either
// way, it goes back to pending so the agent's next run picks it up again.
function replyToMarketingRequest(id, { text, byUserId, byName }) {
  const db = readDb();
  const r = (db.marketingRequests || []).find(x => x.id === Number(id));
  if (!r) return { error: 'Request not found.' };
  if (!text || !text.trim()) return { error: 'Reply cannot be empty.' };
  const isRevision = r.status === 'ready';
  addThreadMessage(db, r, { from: 'requester', text: `${byName ? byName + ': ' : ''}${text}` });
  if (isRevision) r.revisionCount += 1;
  r.status = 'pending';
  writeDb(db);
  return { request: r };
}

// Agent delivering a finished design.
function submitMarketingResult(id, { imageUrl, imagePath, note }) {
  const db = readDb();
  const r = (db.marketingRequests || []).find(x => x.id === Number(id));
  if (!r) return { error: 'Request not found.' };
  if (!imageUrl && !imagePath) return { error: 'A resultImageUrl or resultImagePath is required.' };
  r.status = 'ready';
  r.resultImageUrl = imageUrl || '';
  r.resultImagePath = imagePath || '';
  r.deliveredAt = new Date().toISOString();
  addThreadMessage(db, r, { from: 'agent', text: note || 'Design delivered.' });
  writeDb(db);
  return { request: r };
}

module.exports = {
  CATEGORIES, CATEGORY_LABELS, STATUSES, STATUS_LABELS,
  listMarketingRequests, getMarketingRequest, listPendingMarketingRequests,
  createMarketingRequest, claimMarketingRequest, markMarketingNeedsInfo,
  replyToMarketingRequest, submitMarketingResult
};
