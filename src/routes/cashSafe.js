const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const fileStore = require('../fileStore');

// Cash safe photos are proof-of-who-touched-the-safe, same sensitivity as
// Report evidence — stored in CockroachDB (category 'cash_safe_photo'),
// never reachable by guessing a URL. Everyone who can reach this router
// (requireCashSafeAccess, applied at the app.use('/cash-safe', ...) mount)
// can view them; there's no per-photo recipient split like Reports has, so
// no extra check is needed on the serving route below beyond the category
// match fileStore.sendStoredFile already does.
//
// UPLOAD_DIR is kept only so pre-migration photos already on disk still
// serve correctly (see the /photo/:id route below) — new uploads go into
// the DB instead.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'cash-safe');

const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: fileStore.MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) return cb(new Error('Please take a photo to continue.'));
    cb(null, true);
  }
});

// Only Admin/Senior Manager can change what the safe is expected to hold —
// deliberately narrower than general Cash Safe access (which also covers
// General/Floor Manager and any individually-granted Bar Staff).
const LODGEMENT_EDIT_ROLES = ['admin', 'senior_manager'];

function renderPage(req, res, status, error) {
  const u = res.locals.currentUser;
  const history = models.getCashLodgementHistory();
  res.status(status || 200).render('cash-safe', {
    logs: models.listCashLogs(),
    balance: models.getCurrentSafeBalance(),
    starting: models.getCashSafeLodgementTarget(),
    canEditLodgement: !!(u && LODGEMENT_EDIT_ROLES.includes(u.role)),
    lastLodgementChange: history[0] || null,
    error: error || null
  });
}

router.get('/', (req, res) => {
  renderPage(req, res, 200, null);
});

router.post('/', (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) return renderPage(req, res, 400, err.message || 'Upload failed.');

    const { reason, coinsIn, coinsOut, notesIn, notesOut } = req.body;
    if (!reason || !reason.trim()) {
      return renderPage(req, res, 400, 'Please give a reason for this cash safe change.');
    }
    // A photo of the person submitting is mandatory — this log is the
    // accountability record for who touched the safe.
    if (!req.file) {
      return renderPage(req, res, 400, 'Please take a photo before submitting.');
    }

    let fileId;
    try {
      fileId = await fileStore.saveFile({
        category: 'cash_safe_photo',
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        uploadedByUserId: res.locals.currentUser && res.locals.currentUser.id
      });
    } catch (fileErr) {
      return renderPage(req, res, 400, fileErr.message || 'Upload failed.');
    }

    const u = res.locals.currentUser;
    const entry = models.addCashLog({
      reason,
      coinsIn, coinsOut, notesIn, notesOut,
      loggedByUserId: u && u.id,
      loggedByName: u && u.name,
      photoPath: String(fileId)
    });
    notify.notifySeniorManagerCashLog(entry).catch(() => {});
    res.redirect('/cash-safe');
  });
});

// Expected lodgement (what the safe should hold) — Admin/Senior Manager
// only. Stored server-side in settings, so the very next page load for
// every user (any manager, any granted Bar Staff) picks up the new value —
// there's no per-user copy to keep in sync.
router.post('/lodgement-target', (req, res) => {
  const u = res.locals.currentUser;
  if (!u || !LODGEMENT_EDIT_ROLES.includes(u.role)) {
    return res.status(403).render('403');
  }
  const result = models.setCashSafeLodgementTarget(req.body.amount, u.id, u.name, req.body.reason);
  if (result.error) {
    return renderPage(req, res, 400, result.error);
  }
  res.redirect('/cash-safe');
});

// Serving route is gated by the same requireCashSafeAccess middleware
// applied at the router mount in server.js — no extra per-file check needed
// beyond the category match sendStoredFile does. photoPath is a bare
// numeric file id for anything logged after this migration; anything
// numeric-looking is tried against the DB first, and only falls back to
// disk (pre-migration entries, which stored a filename like
// "cash-<timestamp>-<hex>.jpg") if that's not a valid id.
router.get('/photo/:idOrFilename', async (req, res) => {
  const param = req.params.idOrFilename;
  if (/^\d+$/.test(param)) {
    return fileStore.sendStoredFile(res, param, 'cash_safe_photo');
  }
  const filename = path.basename(param);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).render('404');
  res.sendFile(filePath);
});

module.exports = router;
