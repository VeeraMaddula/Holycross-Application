// Token-protected API for the design agent — a scheduled Claude session
// running separately from this app (see the `agent-workspace` repo), with
// access to the OpenArt image-generation MCP connector that this Express
// server can't call directly. It has no staff login, so instead of a
// session cookie it authenticates with a single shared secret
// (MARKETING_AGENT_TOKEN) sent as `Authorization: Bearer <token>`.
//
// Mounted at /api/marketing-agent in server.js, BEFORE requireAuth (it's
// deliberately not behind the staff login system) and exempted from CSRF
// checks in src/csrf.js (the Bearer token serves the equivalent purpose —
// proving the caller is who they say they are — without needing a browser
// session to have issued it).
const express = require('express');
const path = require('path');
const router = express.Router();
const models = require('../models');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'marketing');

function requireAgentToken(req, res, next) {
  const configured = process.env.MARKETING_AGENT_TOKEN;
  if (!configured) {
    return res.status(503).json({ error: 'MARKETING_AGENT_TOKEN is not configured on the server — the design agent API is disabled until it is set.' });
  }
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!supplied || supplied !== configured) {
    return res.status(401).json({ error: 'Missing or invalid Authorization: Bearer token.' });
  }
  next();
}

router.use(requireAgentToken);

function serializeRequest(r) {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    categoryLabel: models.MARKETING_CATEGORY_LABELS[r.category] || r.category,
    brief: r.brief,
    attachments: (r.attachments || []).map(a => ({
      filename: a.path,
      originalName: a.originalName,
      downloadUrl: `/api/marketing-agent/attachments/${r.id}/${a.path}`
    })),
    requestedByName: r.requestedByName,
    requestedAt: r.requestedAt,
    status: r.status,
    thread: r.thread,
    resultImageUrl: r.resultImageUrl,
    deliveredAt: r.deliveredAt,
    revisionCount: r.revisionCount
  };
}

// Everything currently waiting on the agent, oldest first.
router.get('/pending', (req, res) => {
  res.json({ requests: models.listPendingMarketingRequests().map(serializeRequest) });
});

router.get('/:id', (req, res) => {
  const r = models.getMarketingRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found.' });
  res.json({ request: serializeRequest(r) });
});

// A reference photo attached to a brief.
router.get('/attachments/:requestId/:filename', (req, res) => {
  const request = models.getMarketingRequest(req.params.requestId);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  const file = (request.attachments || []).find(f => f.path === req.params.filename);
  if (!file) return res.status(404).json({ error: 'Attachment not found.' });
  res.sendFile(path.join(UPLOAD_DIR, file.path));
});

// Claim a pending request before starting work on it, so two overlapping
// scheduled runs don't both pick up the same one.
router.post('/:id/claim', (req, res) => {
  const result = models.claimMarketingRequest(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ request: serializeRequest(result.request) });
});

// The agent has a clarifying question before it can start/continue.
router.post('/:id/needs-info', (req, res) => {
  const { question } = req.body || {};
  if (!question || !String(question).trim()) return res.status(400).json({ error: 'question is required.' });
  const result = models.markMarketingNeedsInfo(req.params.id, question);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ request: serializeRequest(result.request) });
});

// Deliver a finished design. imageUrl is expected to be the OpenArt CDN
// link from the generation result (see agent-workspace/CLAUDE.md — those
// URLs may expire/rotate, so the agent should re-check on later runs if a
// requester reports a broken link rather than assuming this app cached it).
router.post('/:id/result', (req, res) => {
  const { imageUrl, imagePath, note } = req.body || {};
  const result = models.submitMarketingResult(req.params.id, { imageUrl, imagePath, note });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ request: serializeRequest(result.request) });
});

module.exports = router;
