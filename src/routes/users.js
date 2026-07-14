const express = require('express');
const router = express.Router();
const models = require('../models');
const { hashPassword, isValidPassword, PASSWORD_RULES } = require('../password');

router.get('/', (req, res) => {
  res.render('users/list', { users: models.listUsers(), error: null, currentUserId: req.session.userId });
});

router.post('/', (req, res) => {
  const { name, username, email, password, role, phone, dob, sex, location } = req.body;
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
  models.createUser({ name, username, email, passwordHash: hashPassword(password), role, phone, dob, sex, location });
  res.redirect('/users');
});

router.get('/:id/edit', (req, res) => {
  const user = models.getUserById(req.params.id);
  if (!user) return res.status(404).render('404');
  res.render('users/edit', { user, error: null });
});

router.post('/:id', (req, res) => {
  const { name, username, email, phone, dob, sex, location } = req.body;
  if (!name || !username || !email || !phone) {
    const user = models.getUserById(req.params.id);
    return res.status(400).render('users/edit', {
      user: { ...user, name, username, email, phone, dob, sex, location },
      error: 'Name, username, email and phone are all required.'
    });
  }
  const result = models.updateUserProfile(req.params.id, { name, username, email, phone, dob, sex, location });
  if (result.error) {
    return res.status(400).render('users/edit', {
      user: { ...models.getUserById(req.params.id), name, username, email, phone, dob, sex, location },
      error: result.error
    });
  }
  res.redirect('/users');
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
