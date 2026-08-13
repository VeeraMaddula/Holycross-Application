// Marketing / Design requests — manager-facing side. Admin/managers submit a
// design brief (with optional reference photos) here; a separate AI design
// agent (see src/routes/marketingAgentApi.js for its token-protected API)
// picks it up out-of-band and posts a finished design back. This file only
// handles the human side: submitting requests, viewing the queue/gallery,
// and replying (answering a clarifying question, or asking for a revision).
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const models = require('../models');

// Reference photos supplied with a brief (e.g. a food photo to be
// incorporated into the design) — same "never under public/" treatment as
// Report evidence, served back out through an authenticated route below.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'marketing');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_TYPES[file.mimetype] || '';
      cb(null, `marketing-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) return cb(new Error(`"${file.originalname}" isn't a supported image type.`));
    cb(null, true);
  }
});

function renderPage(req, res, status, error) {
  res.status(status || 200).render('marketing/index', {
    requests: models.listMarketingRequests(),
    categories: models.MARKETING_CATEGORIES,
    statusLabels: models.MARKETING_STATUS_LABELS,
    error: error || null
  });
}

router.get('/', (req, res) => {
  renderPage(req, res);
});

router.post('/', (req, res) => {
  upload.array('photos', 5)(req, res, (err) => {
    if (err) return renderPage(req, res, 400, err.message || 'Upload failed.');

    const { title, category, brief } = req.body;
    const cleanupUploaded = () => (req.files || []).forEach(f => fs.unlink(f.path, () => {}));

    if (!title || !brief) {
      cleanupUploaded();
      return renderPage(req, res, 400, 'Title and brief are both required.');
    }

    const attachments = (req.files || []).map(f => ({
      path: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size
    }));

    const currentUser = res.locals.currentUser;
    models.createMarketingRequest({
      title, category, brief, attachments,
      requestedByUserId: req.session.userId,
      requestedByName: currentUser ? currentUser.name : 'Unknown'
    });

    res.redirect('/marketing');
  });
});

router.post('/:id/reply', (req, res) => {
  const currentUser = res.locals.currentUser;
  const result = models.replyToMarketingRequest(req.params.id, {
    text: req.body.text,
    byUserId: req.session.userId,
    byName: currentUser ? currentUser.name : null
  });
  if (result.error) return renderPage(req, res, 400, result.error);
  res.redirect('/marketing');
});

// Reference photo attached to a brief — only visible to people with
// Marketing page access (this route is mounted behind requireMarketingAccess
// in server.js, same as the rest of this router).
router.get('/attachments/:requestId/:filename', (req, res) => {
  const request = models.getMarketingRequest(req.params.requestId);
  if (!request) return res.status(404).render('404');
  const file = (request.attachments || []).find(f => f.path === req.params.filename);
  if (!file) return res.status(404).render('404');
  res.sendFile(path.join(UPLOAD_DIR, file.path));
});

module.exports = router;
