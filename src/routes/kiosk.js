const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const models = require('../models');

// Shares the same folder as the profile-page avatar upload (src/routes/profile.js)
// since a kiosk clock-in photo becomes that person's profile picture — same
// thing, just captured on the shared tablet instead of uploaded by hand.
const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    // Doesn't depend on req.body (userId arrives as a separate multipart
    // field and isn't reliably parsed yet when this callback fires) — a
    // timestamp + random suffix is enough to keep filenames unique.
    filename: (req, file, cb) => {
      const ext = ALLOWED_TYPES[file.mimetype] || '.jpg';
      cb(null, `kiosk-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) return cb(new Error('Please capture a photo to continue.'));
    cb(null, true);
  }
});

router.get('/', (req, res) => {
  res.render('kiosk', { staff: models.getKioskRoster() });
});

// Lightweight status refresh for the tile grid — same polling pattern used
// on the Tables page, so a tile flips from "Clocked out" to "Present"
// automatically if someone clocks in on another device.
router.get('/status', (req, res) => {
  const roster = models.getKioskRoster().map(s => ({ id: s.id, status: s.status, avatarPath: s.avatarPath }));
  res.json(roster);
});

// Step 1: tap a tile, enter the PIN. Returns current status + which actions
// are valid next, so the client can render the right buttons.
router.post('/verify', (req, res) => {
  const { userId, pin } = req.body;
  const user = models.getUserById(userId);
  if (!user || !user.active || user.role === 'kiosk') {
    return res.status(400).json({ error: 'Staff member not found.' });
  }
  if (!user.pinHash) {
    return res.status(400).json({ error: 'No PIN set for this account yet — ask a manager to set one on the Users page.' });
  }
  if (!models.verifyUserPin(user.id, pin)) {
    return res.status(400).json({ error: 'Wrong PIN. Try again.' });
  }
  const status = models.getStaffStatus(user.id);
  res.json({ ok: true, status: status.status });
});

// Step 2: tap Clock In / Clock Out / Start Break / End Break. The PIN is
// re-checked server-side rather than trusting the client's earlier /verify
// call, so a tampered request can't skip straight to logging an action.
// Sent as multipart/form-data from the client for every action (simplest to
// have one shape); only "clock_in" actually requires the "photo" field —
// that photo becomes the person's profile picture app-wide, not just a
// kiosk record, so a fresh face shows up on the Dashboard, Staff Status,
// Roster, etc. right after they clock in.
router.post('/action', (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });

    const { userId, pin, action } = req.body;
    const user = models.getUserById(userId);
    if (!user || !user.active || user.role === 'kiosk') {
      return res.status(400).json({ error: 'Staff member not found.' });
    }
    if (!models.verifyUserPin(user.id, pin)) {
      return res.status(400).json({ error: 'Wrong PIN.' });
    }
    const status = models.getStaffStatus(user.id);
    const allowed = models.nextValidAction(status.status);
    const allowedList = Array.isArray(allowed) ? allowed : [allowed].filter(Boolean);
    if (!allowedList.includes(action)) {
      return res.status(400).json({ error: 'That action is no longer available — please try again.' });
    }

    let newAvatarPath = null;
    if (action === 'clock_in') {
      if (!req.file) return res.status(400).json({ error: 'A photo is required to clock in.' });
      if (user.avatarPath) {
        const oldFile = path.join(AVATAR_DIR, path.basename(user.avatarPath));
        fs.unlink(oldFile, () => {});
      }
      newAvatarPath = `/img/avatars/${req.file.filename}`;
      models.setUserAvatar(user.id, newAvatarPath);
    }

    models.addClockEntry({ userId: user.id, userName: user.name, action, selfiePath: newAvatarPath || '' });
    res.json({ ok: true, avatarPath: newAvatarPath });
  });
});

module.exports = router;
