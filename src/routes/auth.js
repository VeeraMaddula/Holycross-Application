const express = require('express');
const router = express.Router();
const models = require('../models');
const { verifyPassword } = require('../password');

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = models.getUserByEmail(email || '');
  if (!user || !user.active || !verifyPassword(password || '', user.passwordHash)) {
    return res.render('login', { error: 'Incorrect email or password.' });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
