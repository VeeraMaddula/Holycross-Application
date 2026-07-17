const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');

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
  const roster = models.getKioskRoster().map(s => ({ id: s.id, status: s.status, avatarPath: s.avatarPath, since: s.since }));
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

// There's no self-service PIN reset from the tablet — that would defeat the
// point of a PIN gate on clock-in — so "Forgot PIN?" just alerts whoever can
// set a new one from the Users page (Manager/Floor Manager/Senior
// Manager/General Manager/Admin).
router.post('/forgot-pin', async (req, res) => {
  const { userId } = req.body;
  const user = models.getUserById(userId);
  if (!user || !user.active || user.role === 'kiosk') {
    return res.status(400).json({ error: 'Staff member not found.' });
  }
  await notify.notifyManagersPinResetRequest(user);
  res.json({ ok: true });
});

// clock_in / break_start / break_end all capture a fresh photo — it becomes
// the person's "live" picture for the rest of their shift (liveShiftAvatarPath),
// shown everywhere in place of their saved profile picture without ever
// touching that saved picture. clock_out needs no photo and clears the live
// photo, so their normal profile picture reappears everywhere.
const PHOTO_ACTIONS = ['clock_in', 'break_start', 'break_end'];

// Step 2: tap Clock In / Clock Out / Start Break / End Break. The PIN is
// re-checked server-side rather than trusting the client's earlier /verify
// call, so a tampered request can't skip straight to logging an action.
// Always sent as multipart/form-data from the client (simplest to have one
// shape); only the PHOTO_ACTIONS above actually include a "photo" field.
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

    // Only ever deletes the temporary live-shift photo file — never the
    // person's actual saved profile picture (public/img/avatars/user-*).
    function dropLiveShiftFile() {
      if (user.liveShiftAvatarPath) {
        fs.unlink(path.join(AVATAR_DIR, path.basename(user.liveShiftAvatarPath)), () => {});
      }
    }

    let effectiveAvatarPath;
    if (PHOTO_ACTIONS.includes(action)) {
      if (!req.file) return res.status(400).json({ error: 'A photo is required for this step.' });
      dropLiveShiftFile();
      effectiveAvatarPath = `/img/avatars/${req.file.filename}`;
      models.setUserLiveShiftAvatar(user.id, effectiveAvatarPath);
    } else {
      // clock_out — revert to their saved profile picture (may be '').
      dropLiveShiftFile();
      models.setUserLiveShiftAvatar(user.id, '');
      effectiveAvatarPath = user.avatarPath || '';
    }

    models.addClockEntry({
      userId: user.id,
      userName: user.name,
      action,
      selfiePath: PHOTO_ACTIONS.includes(action) ? effectiveAvatarPath : ''
    });
    res.json({ ok: true, avatarPath: effectiveAvatarPath });
  });
});

module.exports = router;
