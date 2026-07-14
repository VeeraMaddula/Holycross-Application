const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const models = require('../models');

const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_TYPES[file.mimetype] || '.jpg';
    cb(null, `user-${req.session.userId}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      return cb(new Error('Please upload a JPG, PNG, or WEBP image.'));
    }
    cb(null, true);
  }
});

router.get('/', (req, res) => {
  const user = models.getUserById(req.session.userId);
  res.render('profile', { profileUser: user, error: null, success: null });
});

router.post('/avatar', (req, res) => {
  upload.single('avatar')(req, res, (err) => {
    // The cropper UI submits via fetch() and asks for JSON; a plain <form>
    // submit (JS-disabled fallback / "upload without cropping") gets an
    // HTML re-render of the profile page instead.
    const wantsJson = (req.headers.accept || '').includes('application/json');
    const user = models.getUserById(req.session.userId);

    if (err) {
      const message = err.message || 'Upload failed.';
      if (wantsJson) return res.status(400).json({ error: message });
      return res.status(400).render('profile', { profileUser: user, error: message, success: null });
    }
    if (!req.file) {
      const message = 'Please choose an image file.';
      if (wantsJson) return res.status(400).json({ error: message });
      return res.status(400).render('profile', { profileUser: user, error: message, success: null });
    }

    // Remove the old avatar file (if any) so we don't accumulate old uploads.
    if (user.avatarPath) {
      const oldFile = path.join(AVATAR_DIR, path.basename(user.avatarPath));
      fs.unlink(oldFile, () => {});
    }

    const newAvatarPath = `/img/avatars/${req.file.filename}`;
    models.setUserAvatar(req.session.userId, newAvatarPath);
    req.session.avatarPath = newAvatarPath;

    if (wantsJson) return res.json({ ok: true, avatarPath: newAvatarPath });

    const updatedUser = models.getUserById(req.session.userId);
    res.render('profile', { profileUser: updatedUser, error: null, success: 'Profile picture updated.' });
  });
});

router.post('/avatar/remove', (req, res) => {
  const user = models.getUserById(req.session.userId);
  if (user.avatarPath) {
    const oldFile = path.join(AVATAR_DIR, path.basename(user.avatarPath));
    fs.unlink(oldFile, () => {});
  }
  models.setUserAvatar(req.session.userId, '');
  req.session.avatarPath = '';
  res.redirect('/profile');
});

module.exports = router;
