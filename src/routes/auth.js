const express = require('express');
const router = express.Router();
const models = require('../models');
const { verifyPassword } = require('../password');
const { COUNTRY_CODES } = require('../phoneUtils');

const REMEMBER_ME_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 days
const DEFAULT_MAX_AGE = 1000 * 60 * 60 * 12; // 12 hours — matches the session default in server.js

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null, countryCodes: COUNTRY_CODES });
});

router.post('/login', (req, res) => {
  const { identifier, countryCode, password, rememberMe } = req.body;
  const user = models.getUserByLoginIdentifier(identifier || '', countryCode || '');
  if (!user || !user.active || !verifyPassword(password || '', user.passwordHash)) {
    return res.render('login', { error: 'Incorrect username/phone number or password.', countryCodes: COUNTRY_CODES });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  req.session.cookie.maxAge = rememberMe ? REMEMBER_ME_MAX_AGE : DEFAULT_MAX_AGE;
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
