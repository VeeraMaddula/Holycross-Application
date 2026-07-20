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

function renderPage(res, status, error) {
  res.status(status || 200).render('cash-safe', {
    logs: models.listCashLogs(),
    balance: models.getCurrentSafeBalance(),
    starting: models.SAFE_STARTING_BALANCE,
    error: error || null
  });
}

router.get('/', (req, res) => {
  renderPage(res, 200, null);
});

router.post('/', (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) return renderPage(res, 400, err.message || 'Upload failed.');

    const { reason, coinsIn, coinsOut, notesIn, notesOut } = req.body;
    if (!reason || !reason.trim()) {
      return renderPage(res, 400, 'Please give a reason for this cash safe change.');
    }
    // A photo of the person submitting is mandatory — this log is the
    // accountability record for who touched the safe.
    if (!req.file) {
      return renderPage(res, 400, 'Please take a photo before submitting.');
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

// Serving route is gated by the same requireCashSafeAccess middleware
// applied at the router mount in server.js — no extra per-file check needed.
router.get('/photo/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).render('404');
  res.sendFile(filePath);
});

module.exports = router;
