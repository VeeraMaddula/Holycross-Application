const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');

// Cash safe photos are proof-of-who-touched-the-safe, same sensitivity as
// Report evidence — kept outside public/ so they're never reachable by
// guessing a URL. Everyone who can reach this router (requireCashSafeAccess,
// applied at the app.use('/cash-safe', ...) mount) can view them; there's no
// per-photo recipient split like Reports has, so no extra check is needed
// on the serving route below.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'cash-safe');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_TYPES[file.mimetype] || '.jpg';
      cb(null, `cash-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
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

    const u = res.locals.currentUser;
    const entry = models.addCashLog({
      reason,
      coinsIn, coinsOut, notesIn, notesOut,
      loggedByUserId: u && u.id,
      loggedByName: u && u.name,
      photoPath: req.file.filename
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
// applied at the router mount in server.js — no extra per-file check needed.
router.get('/photo/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).render('404');
  res.sendFile(filePath);
});

module.exports = router;
