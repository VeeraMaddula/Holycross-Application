const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const { ROLE_LABELS, MANAGER_ROLES } = require('../roles');
const fileStore = require('../fileStore');

// Report evidence (photos, screenshots, chat exports) can be genuinely
// sensitive, so — unlike avatars — these never live under public/ where
// they'd be reachable by anyone who guesses/finds the URL. Images go into
// CockroachDB (category 'report_photo'); video/audio/PDF/Word/text
// attachments stay on disk here — CockroachDB recommends keeping stored
// BYTES values under ~1MB, and these are allowed up to 20MB, so they're not
// a fit for the files table. Both kinds are served back out through the
// same authenticated route at the bottom of this file.
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

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Custom storage: images are buffered and saved straight into CockroachDB
// (the resulting file gets a `.dbFileId` instead of `.path`/`.filename`);
// everything else streams to disk exactly as before. multer only supports
// one storage engine per instance, hence the branch on mimetype here rather
// than two separate multer() configs for one 'files' field.
const mixedStorage = {
  _handleFile(req, file, cb) {
    if (IMAGE_MIME_TYPES.has(file.mimetype)) {
      const chunks = [];
      file.stream.on('data', (chunk) => chunks.push(chunk));
      file.stream.on('error', cb);
      file.stream.on('end', async () => {
        const buffer = Buffer.concat(chunks);
        try {
          const dbFileId = await fileStore.saveFile({
            category: 'report_photo',
            filename: file.originalname,
            mimeType: file.mimetype,
            buffer,
            uploadedByUserId: req.session && req.session.userId
          });
          cb(null, { dbFileId, size: buffer.length });
        } catch (err) {
          cb(err);
        }
      });
    } else {
      const ext = ALLOWED_TYPES[file.mimetype] || '';
      const filename = `report-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      const outPath = path.join(UPLOAD_DIR, filename);
      const outStream = fs.createWriteStream(outPath);
      file.stream.pipe(outStream);
      outStream.on('error', cb);
      outStream.on('finish', () => cb(null, { path: outPath, filename, size: outStream.bytesWritten }));
    }
  },
  _removeFile(req, file, cb) {
    if (file.path) return fs.unlink(file.path, () => cb(null));
    cb(null);
  }
};

const upload = multer({
  storage: mixedStorage,
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) return cb(new Error(`"${file.originalname}" isn't a supported file type.`));
    cb(null, true);
  }
});

// Recipients are restricted to management-tier roles — reports are meant
// to go to someone who can act on them, not to any random colleague.
async function recipientOptions(currentUserId) {
  return (await models.listUsers())
    .filter(u => u.active && u.id !== Number(currentUserId) && MANAGER_ROLES.includes(u.role))
    .map(u => ({ id: u.id, name: u.name, roleLabel: ROLE_LABELS[u.role] || u.role }));
}

async function renderPage(req, res, status, error) {
  const { sent, received } = models.listReportsForUser(req.session.userId);
  res.status(status || 200).render('reports', {
    sent, received,
    recipients: await recipientOptions(req.session.userId),
    categories: models.REPORT_CATEGORIES,
    error: error || null
  });
}

router.get('/', async (req, res) => {
  await renderPage(req, res);
});

router.post('/', (req, res) => {
  upload.array('files', 5)(req, res, async (err) => {
    if (err) return await renderPage(req, res, 400, err.message || 'Upload failed.');

    const { category, details, recipientUserId } = req.body;
    const cleanupUploaded = () => (req.files || []).forEach(f => {
      if (f.dbFileId) fileStore.deleteFile(f.dbFileId).catch(() => {});
      else if (f.path) fs.unlink(f.path, () => {});
    });

    if (!category || !details || !recipientUserId) {
      cleanupUploaded();
      return await renderPage(req, res, 400, 'Category, recipient, and details are all required.');
    }

    // Images already saved into CockroachDB by mixedStorage above get a
    // "db:<id>" marker instead of a disk filename — the serving route below
    // knows to tell the two apart.
    const files = (req.files || []).map(f => ({
      path: f.dbFileId ? `db:${f.dbFileId}` : f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size
    }));

    const result = await models.createReport({
      category,
      details,
      files,
      reportedByUserId: req.session.userId,
      recipientUserId
    });
    if (result.error) {
      cleanupUploaded();
      return await renderPage(req, res, 400, result.error);
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

// The person who filed the report, the person it was sent to, an Admin, or
// anyone with access to the Logs page (every manager-tier role, or a
// specific staff member individually granted it — see requireLogsAccess in
// src/middleware.js) can fetch an attached file — everyone else gets a 403,
// even if they guess a valid-looking URL. The Logs-access allowance exists
// so the Reports section of /logs can actually show evidence thumbnails to
// managers who weren't the original reporter/recipient.
router.get('/file/:reportId/:filename', async (req, res) => {
  const report = models.getReport(req.params.reportId);
  if (!report) return res.status(404).render('404');
  const uid = Number(req.session.userId);
  const cu = res.locals.currentUser;
  const isAllowed = req.session.role === 'admin' || report.reportedByUserId === uid || report.recipientUserId === uid
    || (cu && (MANAGER_ROLES.includes(cu.role) || cu.canViewLogs));
  if (!isAllowed) return res.status(403).render('403');
  const file = report.files.find(f => f.path === req.params.filename);
  if (!file) return res.status(404).render('404');
  if (file.path.startsWith('db:')) {
    return fileStore.sendStoredFile(res, file.path.slice(3), 'report_photo');
  }
  res.sendFile(path.join(UPLOAD_DIR, file.path));
});

module.exports = router;
