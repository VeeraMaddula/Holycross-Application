const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const { ROLE_LABELS, MANAGER_ROLES } = require('../roles');

// Report evidence (photos, screenshots, chat exports) can be genuinely
// sensitive, so — unlike avatars — these never live under public/ where
// they'd be reachable by anyone who guesses/finds the URL. They're served
// back out through the authenticated route at the bottom of this file.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'reports');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Deliberately an allowlist, not "any kind of file" literally — executables
// and scripts are never accepted, only the kinds of evidence a report would
// realistically need: photos/video from a phone camera, screenshots, chat
// exports, voice notes, and common document formats.
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt'
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_TYPES[file.mimetype] || '';
      cb(null, `report-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) return cb(new Error(`"${file.originalname}" isn't a supported file type.`));
    cb(null, true);
  }
});

// Recipients are restricted to management-tier roles — reports are meant
// to go to someone who can act on them, not to any random colleague.
function recipientOptions(currentUserId) {
  return models.listUsers()
    .filter(u => u.active && u.id !== Number(currentUserId) && MANAGER_ROLES.includes(u.role))
    .map(u => ({ id: u.id, name: u.name, roleLabel: ROLE_LABELS[u.role] || u.role }));
}

function renderPage(req, res, status, error) {
  const { sent, received } = models.listReportsForUser(req.session.userId);
  res.status(status || 200).render('reports', {
    sent, received,
    recipients: recipientOptions(req.session.userId),
    categories: models.REPORT_CATEGORIES,
    error: error || null
  });
}

router.get('/', (req, res) => {
  renderPage(req, res);
});

router.post('/', (req, res) => {
  upload.array('files', 5)(req, res, (err) => {
    if (err) return renderPage(req, res, 400, err.message || 'Upload failed.');

    const { category, details, recipientUserId } = req.body;
    const cleanupUploaded = () => (req.files || []).forEach(f => fs.unlink(f.path, () => {}));

    if (!category || !details || !recipientUserId) {
      cleanupUploaded();
      return renderPage(req, res, 400, 'Category, recipient, and details are all required.');
    }

    const files = (req.files || []).map(f => ({
      path: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size
    }));

    const result = models.createReport({
      category,
      details,
      files,
      reportedByUserId: req.session.userId,
      recipientUserId
    });
    if (result.error) {
      cleanupUploaded();
      return renderPage(req, res, 400, result.error);
    }

    const recipient = result.report.recipient;
    if (recipient && recipient.email) {
      const { subject, text } = notify.reportSubmittedEmail(result.report);
      notify.sendEmail({ to: recipient.email, subject, text, type: 'staff-report' });
    }

    res.redirect('/reports');
  });
});

router.post('/:id/reviewed', (req, res) => {
  const result = models.markReportReviewed(req.params.id, req.session.userId);
  if (result.error) return res.status(403).render('403');
  res.redirect('/reports');
});

// Only the person who filed the report, the person it was sent to, or an
// Admin can ever fetch an attached file — everyone else gets a 403, even
// if they guess a valid-looking URL.
router.get('/file/:reportId/:filename', (req, res) => {
  const report = models.getReport(req.params.reportId);
  if (!report) return res.status(404).render('404');
  const uid = Number(req.session.userId);
  const isAllowed = req.session.role === 'admin' || report.reportedByUserId === uid || report.recipientUserId === uid;
  if (!isAllowed) return res.status(403).render('403');
  const file = report.files.find(f => f.path === req.params.filename);
  if (!file) return res.status(404).render('404');
  res.sendFile(path.join(UPLOAD_DIR, file.path));
});

module.exports = router;
