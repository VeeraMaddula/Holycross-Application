const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const { hashPassword, isValidPassword, PASSWORD_RULES } = require('../password');

// Same avatar folder used by the profile page's self-service upload and by
// the kiosk's live shift photos — this route lets an admin set someone's
// saved profile picture directly from the Users page (e.g. right after
// creating their account), instead of relying on that person to log in and
// upload one themselves.
const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });
const ALLOWED_AVATAR_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_AVATAR_TYPES[file.mimetype] || '.jpg';
      cb(null, `user-${req.params.id}-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_AVATAR_TYPES[file.mimetype]) return cb(new Error('Please upload a JPG, PNG, or WEBP image.'));
    cb(null, true);
  }
});

router.get('/', (req, res) => {
  res.render('users/list', { users: models.listUsers(), error: null, currentUserId: req.session.userId });
});

router.post('/', (req, res) => {
  const { name, username, email, password, role, phone, dob, sex, location, pin } = req.body;
  if (!name || !email || !password) {
    return res.status(400).render('users/list', {
      users: models.listUsers(),
      error: 'Name, email and password are all required.',
      currentUserId: req.session.userId
    });
  }
  if (!username) {
    return res.status(400).render('users/list', {
      users: models.listUsers(),
      error: 'Username is required — it\'s what this person will log in with, along with their phone number.',
      currentUserId: req.session.userId
    });
  }
  if (!phone) {
    return res.status(400).render('users/list', {
      users: models.listUsers(),
      error: 'Phone number is required — it\'s used to text staff their shift notifications.',
      currentUserId: req.session.userId
    });
  }
  if (!isValidPassword(password)) {
    return res.status(400).render('users/list', {
      users: models.listUsers(),
      error: PASSWORD_RULES,
      currentUserId: req.session.userId
    });
  }
  if (models.getUserByUsername(username)) {
    return res.status(400).render('users/list', {
      users: models.listUsers(),
      error: 'A user with that username already exists.',
      currentUserId: req.session.userId
    });
  }
  if (models.getUserByEmail(email)) {
    return res.status(400).render('users/list', {
      users: models.listUsers(),
      error: 'A user with that email already exists.',
      currentUserId: req.session.userId
    });
  }
  if (pin && !/^\d{4}$/.test(pin)) {
    return res.status(400).render('users/list', {
      users: models.listUsers(),
      error: 'Kiosk PIN must be exactly 4 digits — leave it blank to set one later.',
      currentUserId: req.session.userId
    });
  }
  const newUser = models.createUser({ name, username, email, passwordHash: hashPassword(password), role, phone, dob, sex, location });
  // Kiosk PIN is optional at creation — set it now if one was entered, so a
  // new starter can be handed straight to the tablet without a second trip
  // through Edit first.
  if (pin) models.setUserPin(newUser.id, pin);
  res.redirect('/users');
});

router.get('/:id/edit', (req, res) => {
  const user = models.getUserById(req.params.id);
  if (!user) return res.status(404).render('404');
  res.render('users/edit', { user, error: null, pinError: null, pinSaved: false, avatarError: null });
});

router.post('/:id', (req, res) => {
  const { name, username, email, phone, dob, sex, location } = req.body;
  if (!name || !username || !email || !phone) {
    const user = models.getUserById(req.params.id);
    return res.status(400).render('users/edit', {
      user: { ...user, name, username, email, phone, dob, sex, location },
      error: 'Name, username, email and phone are all required.',
      pinError: null, pinSaved: false, avatarError: null
    });
  }
  const result = models.updateUserProfile(req.params.id, { name, username, email, phone, dob, sex, location });
  if (result.error) {
    return res.status(400).render('users/edit', {
      user: { ...models.getUserById(req.params.id), name, username, email, phone, dob, sex, location },
      error: result.error,
      pinError: null, pinSaved: false, avatarError: null
    });
  }
  res.redirect('/users');
});

router.post('/:id/pin', (req, res) => {
  const user = models.getUserById(req.params.id);
  if (!user) return res.status(404).render('404');
  const result = models.setUserPin(req.params.id, req.body.pin);
  if (result.error) {
    return res.status(400).render('users/edit', { user, error: null, pinError: result.error, pinSaved: false, avatarError: null });
  }
  res.render('users/edit', { user: models.getUserById(req.params.id), error: null, pinError: null, pinSaved: true, avatarError: null });
});

router.post('/:id/avatar', (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    const user = models.getUserById(req.params.id);
    if (!user) return res.status(404).render('404');
    const message = err ? (err.message || 'Upload failed.') : (!req.file ? 'Please choose an image file.' : null);
    if (message) {
      return res.status(400).render('users/edit', { user, error: null, pinError: null, pinSaved: false, avatarError: message });
    }
    if (user.avatarPath) {
      fs.unlink(path.join(AVATAR_DIR, path.basename(user.avatarPath)), () => {});
    }
    models.setUserAvatar(user.id, `/img/avatars/${req.file.filename}`);
    res.redirect(`/users/${user.id}/edit`);
  });
});

router.post('/:id/avatar/remove', (req, res) => {
  const user = models.getUserById(req.params.id);
  if (!user) return res.status(404).render('404');
  if (user.avatarPath) {
    fs.unlink(path.join(AVATAR_DIR, path.basename(user.avatarPath)), () => {});
  }
  models.setUserAvatar(user.id, '');
  res.redirect(`/users/${user.id}/edit`);
});

router.post('/:id/toggle-active', (req, res) => {
  const target = models.getUserById(req.params.id);
  const result = models.setUserActive(req.params.id, !(target && target.active));
  if (result.error) {
    return res.status(400).render('users/list', { users: models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/role', (req, res) => {
  const result = models.setUserRole(req.params.id, req.body.role);
  if (result.error) {
    return res.status(400).render('users/list', { users: models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/timesheet-access', (req, res) => {
  const target = models.getUserById(req.params.id);
  const result = models.setUserTimesheetAccess(req.params.id, !(target && target.canViewTimesheets));
  if (result.error) {
    return res.status(400).render('users/list', { users: models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/roster-access', (req, res) => {
  const target = models.getUserById(req.params.id);
  const result = models.setUserRosterAccess(req.params.id, !(target && target.canManageRoster));
  if (result.error) {
    return res.status(400).render('users/list', { users: models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/requests-access', (req, res) => {
  const target = models.getUserById(req.params.id);
  const result = models.setUserRequestsAccess(req.params.id, !(target && target.canMakeRequests));
  if (result.error) {
    return res.status(400).render('users/list', { users: models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/function-bookings-access', (req, res) => {
  const target = models.getUserById(req.params.id);
  const result = models.setUserFunctionBookingAccess(req.params.id, !(target && target.canBookFunctions));
  if (result.error) {
    return res.status(400).render('users/list', { users: models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/notifications-access', (req, res) => {
  const target = models.getUserById(req.params.id);
  const result = models.setUserNotificationsAccess(req.params.id, !(target && target.canViewNotifications));
  if (result.error) {
    return res.status(400).render('users/list', { users: models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/color', (req, res) => {
  const result = models.setUserColor(req.params.id, req.body.color);
  if (result.error) {
    return res.status(400).render('users/list', { users: models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

module.exports = router;
