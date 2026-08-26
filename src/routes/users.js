const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const { hashPassword, isValidPassword, PASSWORD_RULES } = require('../password');
const fileStore = require('../fileStore');

// This route lets an admin set someone's saved profile picture directly
// from the Users page (e.g. right after creating their account), instead of
// relying on that person to log in and upload one themselves. Kept only as
// a fallback target for cleaning up pre-migration on-disk avatars.
const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'avatars');
const ALLOWED_AVATAR_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: fileStore.MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_AVATAR_TYPES[file.mimetype]) return cb(new Error('Please upload a JPG, PNG, or WEBP image.'));
    cb(null, true);
  }
});

router.get('/', async (req, res) => {
  res.render('users/list', { users: await models.listUsers(), error: null, currentUserId: req.session.userId });
});

router.post('/', async (req, res) => {
  const { name, username, email, password, role, phone, dob, sex, location, pin } = req.body;
  if (!name || !email || !password) {
    return res.status(400).render('users/list', {
      users: await models.listUsers(),
      error: 'Name, email and password are all required.',
      currentUserId: req.session.userId
    });
  }
  if (!username) {
    return res.status(400).render('users/list', {
      users: await models.listUsers(),
      error: 'Username is required — it\'s what this person will log in with, along with their phone number.',
      currentUserId: req.session.userId
    });
  }
  if (!phone) {
    return res.status(400).render('users/list', {
      users: await models.listUsers(),
      error: 'Phone number is required — it\'s used to text staff their shift notifications.',
      currentUserId: req.session.userId
    });
  }
  if (!isValidPassword(password)) {
    return res.status(400).render('users/list', {
      users: await models.listUsers(),
      error: PASSWORD_RULES,
      currentUserId: req.session.userId
    });
  }
  if (await models.getUserByUsername(username)) {
    return res.status(400).render('users/list', {
      users: await models.listUsers(),
      error: 'A user with that username already exists.',
      currentUserId: req.session.userId
    });
  }
  if (await models.getUserByEmail(email)) {
    return res.status(400).render('users/list', {
      users: await models.listUsers(),
      error: 'A user with that email already exists.',
      currentUserId: req.session.userId
    });
  }
  if (pin && !/^\d{4}$/.test(pin)) {
    return res.status(400).render('users/list', {
      users: await models.listUsers(),
      error: 'Kiosk PIN must be exactly 4 digits — leave it blank to set one later.',
      currentUserId: req.session.userId
    });
  }
  const newUser = await models.createUser({ name, username, email, passwordHash: hashPassword(password), role, phone, dob, sex, location });
  // Kiosk PIN is optional at creation — set it now if one was entered, so a
  // new starter can be handed straight to the tablet without a second trip
  // through Edit first.
  if (pin) await models.setUserPin(newUser.id, pin);
  res.redirect('/users');
});

router.get('/:id/edit', async (req, res) => {
  const user = await models.getUserById(req.params.id);
  if (!user) return res.status(404).render('404');
  res.render('users/edit', { user, error: null, pinError: null, pinSaved: false, avatarError: null });
});

router.post('/:id', async (req, res) => {
  const { name, username, email, phone, dob, sex, location } = req.body;
  if (!name || !username || !email || !phone) {
    const user = await models.getUserById(req.params.id);
    return res.status(400).render('users/edit', {
      user: { ...user, name, username, email, phone, dob, sex, location },
      error: 'Name, username, email and phone are all required.',
      pinError: null, pinSaved: false, avatarError: null
    });
  }
  const result = await models.updateUserProfile(req.params.id, { name, username, email, phone, dob, sex, location });
  if (result.error) {
    return res.status(400).render('users/edit', {
      user: { ...(await models.getUserById(req.params.id)), name, username, email, phone, dob, sex, location },
      error: result.error,
      pinError: null, pinSaved: false, avatarError: null
    });
  }
  res.redirect('/users');
});

router.post('/:id/pin', async (req, res) => {
  const user = await models.getUserById(req.params.id);
  if (!user) return res.status(404).render('404');
  const result = await models.setUserPin(req.params.id, req.body.pin);
  if (result.error) {
    return res.status(400).render('users/edit', { user, error: null, pinError: result.error, pinSaved: false, avatarError: null });
  }
  res.render('users/edit', { user: await models.getUserById(req.params.id), error: null, pinError: null, pinSaved: true, avatarError: null });
});

router.post('/:id/avatar', (req, res) => {
  avatarUpload.single('avatar')(req, res, async (err) => {
    const user = await models.getUserById(req.params.id);
    if (!user) return res.status(404).render('404');
    const message = err ? (err.message || 'Upload failed.') : (!req.file ? 'Please choose an image file.' : null);
    if (message) {
      return res.status(400).render('users/edit', { user, error: null, pinError: null, pinSaved: false, avatarError: message });
    }
    let fileId;
    try {
      fileId = await fileStore.saveFile({
        category: 'avatar',
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        uploadedByUserId: req.session.userId
      });
    } catch (fileErr) {
      return res.status(400).render('users/edit', { user, error: null, pinError: null, pinSaved: false, avatarError: fileErr.message || 'Upload failed.' });
    }
    fileStore.deleteStoredImageRef(user.avatarPath, AVATAR_DIR);
    await models.setUserAvatar(user.id, `/files/${fileId}`);
    res.redirect(`/users/${user.id}/edit`);
  });
});

router.post('/:id/avatar/remove', async (req, res) => {
  const user = await models.getUserById(req.params.id);
  if (!user) return res.status(404).render('404');
  fileStore.deleteStoredImageRef(user.avatarPath, AVATAR_DIR);
  await models.setUserAvatar(user.id, '');
  res.redirect(`/users/${user.id}/edit`);
});

router.post('/:id/toggle-active', async (req, res) => {
  const target = await models.getUserById(req.params.id);
  const result = await models.setUserActive(req.params.id, !(target && target.active));
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/role', async (req, res) => {
  const result = await models.setUserRole(req.params.id, req.body.role);
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/timesheet-access', async (req, res) => {
  const target = await models.getUserById(req.params.id);
  const result = await models.setUserTimesheetAccess(req.params.id, !(target && target.canViewTimesheets));
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/roster-access', async (req, res) => {
  const target = await models.getUserById(req.params.id);
  const result = await models.setUserRosterAccess(req.params.id, !(target && target.canManageRoster));
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/requests-access', async (req, res) => {
  const target = await models.getUserById(req.params.id);
  const result = await models.setUserRequestsAccess(req.params.id, !(target && target.canMakeRequests));
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/function-bookings-access', async (req, res) => {
  const target = await models.getUserById(req.params.id);
  const result = await models.setUserFunctionBookingAccess(req.params.id, !(target && target.canBookFunctions));
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/notifications-access', async (req, res) => {
  const target = await models.getUserById(req.params.id);
  const result = await models.setUserNotificationsAccess(req.params.id, !(target && target.canViewNotifications));
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/cash-safe-access', async (req, res) => {
  const target = await models.getUserById(req.params.id);
  const result = await models.setUserCashSafeAccess(req.params.id, !(target && target.canManageCashSafe));
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/logs-access', async (req, res) => {
  const target = await models.getUserById(req.params.id);
  const result = await models.setUserLogsAccess(req.params.id, !(target && target.canViewLogs));
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/duties-edit-access', async (req, res) => {
  const target = await models.getUserById(req.params.id);
  const result = await models.setUserDutiesEditAccess(req.params.id, !(target && target.canEditDuties));
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/training-edit-access', async (req, res) => {
  const target = await models.getUserById(req.params.id);
  const result = await models.setUserTrainingEditAccess(req.params.id, !(target && target.canEditTraining));
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

router.post('/:id/color', async (req, res) => {
  const result = await models.setUserColor(req.params.id, req.body.color);
  if (result.error) {
    return res.status(400).render('users/list', { users: await models.listUsers(), error: result.error, currentUserId: req.session.userId });
  }
  res.redirect('/users');
});

module.exports = router;
