const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const models = require('../models');

const SELFIE_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'clock-selfies');
fs.mkdirSync(SELFIE_DIR, { recursive: true });

const ACTION_LABELS = {
  clock_in: 'Clocked in',
  clock_out: 'Clocked out',
  break_start: 'Started break',
  break_end: 'Ended break'
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, SELFIE_DIR),
    filename: (req, file, cb) => cb(null, `clock-${req.session.userId}-${Date.now()}.jpg`)
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Please capture a photo to continue.'));
    }
    cb(null, true);
  }
});

router.get('/', (req, res) => {
  const { status, since } = models.getStaffStatus(req.session.userId);
  res.render('clock', { status, since, error: null });
});

router.post('/action', (req, res) => {
  upload.single('selfie')(req, res, (err) => {
    const { status, since } = models.getStaffStatus(req.session.userId);
    const wantsJson = (req.headers.accept || '').includes('application/json');

    if (err) {
      const message = err.message || 'Upload failed.';
      if (wantsJson) return res.status(400).json({ error: message });
      return res.status(400).render('clock', { status, since, error: message });
    }
    if (!req.file) {
      const message = 'A photo is required to clock in/out.';
      if (wantsJson) return res.status(400).json({ error: message });
      return res.status(400).render('clock', { status, since, error: message });
    }

    const requestedAction = req.body.action;
    const allowed = models.nextValidAction(status);
    const allowedList = Array.isArray(allowed) ? allowed : [allowed].filter(Boolean);
    if (!allowedList.includes(requestedAction)) {
      const message = 'That action is no longer available — please refresh and try again.';
      if (wantsJson) return res.status(400).json({ error: message });
      return res.status(400).render('clock', { status, since, error: message });
    }

    const selfiePath = `/img/clock-selfies/${req.file.filename}`;
    models.addClockEntry({
      userId: req.session.userId,
      userName: res.locals.currentUser.name,
      action: requestedAction,
      selfiePath
    });

    if (wantsJson) return res.json({ ok: true, message: ACTION_LABELS[requestedAction] });

    res.redirect('/clock');
  });
});

module.exports = router;
