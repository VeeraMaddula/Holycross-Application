const express = require('express');
const router = express.Router();
const models = require('../models');
const { hashPassword } = require('../password');

router.get('/', (req, res) => {
  res.render('users/list', { users: models.listUsers(), error: null, currentUserId: req.session.userId });
});

router.post('/', (req, res) => {
  const { name, email, password, role, phone, dob, sex, location } = req.body;
  if (!name || !email || !password) {
    return res.status(400).render('users/list', {
      users: models.listUsers(),
      error: 'Name, email and password are all required.',
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
  if (models.getUserByEmail(email)) {
    return res.status(400).render('users/list', {
      users: models.listUsers(),
      error: 'A user with that email already exists.',
      currentUserId: req.session.userId
    });
  }
  models.createUser({ name, email, passwordHash: hashPassword(password), role, phone, dob, sex, location });
  res.redirect('/users');
});

router.get('/:id/edit', (req, res) => {
  const user = models.getUserById(req.params.id);
  if (!user) return res.status(404).render('404');
  res.render('users/edit', { user, error: null });
});

router.post('/:id', (req, res) => {
  const { name, email, phone, dob, sex, location } = req.body;
  if (!name || !email || !phone) {
    const user = models.getUserById(req.params.id);
    return res.status(400).render('users/edit', {
      user: { ...user, name, email, phone, dob, sex, location },
      error: 'Name, email and phone are all required.'
    });
  }
  const result = models.updateUserProfile(req.params.id, { name, email, phone, dob, sex, location });
  if (result.error) {
    return res.status(400).render('users/edit', {
      user: { ...models.getUserById(req.params.id), name, emai