const express = require('express');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const { verifyPassword, isValidPassword, PASSWORD_RULES } = require('../password');
const { COUNTRY_CODES } = require('../phoneUtils');

const REMEMBER_ME_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 days
const DEFAULT_MAX_AGE = 1000 * 60 * 60 * 12; // 12 hours — matches the session default in server.js

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null, countryCodes: COUNTRY_CODES, resetSuccess: false });
});

router.post('/login', (req, res) => {
  const { identifier, countryCode, password, rememberMe } = req.body;
  const user = models.getUserByLoginIdentifier(identifier || '', countryCode || '');
  if (!user || !user.active || !verifyPassword(password || '', user.passwordHash)) {
    return res.render('login', { error: 'Incorrect username/phone number or password.', countryCodes: COUNTRY_CODES, resetSuccess: false });
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

// ---- Forgot password ----
router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { sent: false, countryCodes: COUNTRY_CODES });
});

router.post('/forgot-password', async (req, res) => {
  const { identifier, countryCode } = req.body;
  const result = models.createPasswordResetToken(identifier || '', countryCode || '');
  if (result && result.user.email) {
    const resetLink = `${req.protocol}://${req.get('host')}/reset-password/${result.token}`;
    const { subject, text } = notify.passwordResetEmail(result.user, resetLink);
    notify.sendEmail({ to: result.user.email, subject, text, type: 'password-reset' });
  }
  // Same message whether or not an account was found — never confirm or
  // deny which identifiers exist.
  res.render('forgot-password', { sent: true, countryCodes: COUNTRY_CODES });
});

router.get('/reset-password/:token', (req, res) => {
  const user = models.getUserByResetToken(req.params.token);
  res.render('reset-password', { valid: !!user, error: null, token: req.params.token, passwordRules: PASSWORD_RULES });
});

router.post('/reset-password/:token', (req, res) => {
  const { password, confirmPassword } = req.body;
  const user = models.getUserByResetToken(req.params.token);
  if (!user) {
    return res.render('reset-password', { valid: false, error: null, token: req.params.token, passwordRules: PASSWORD_RULES });
  }
  if (password !== confirmPassword) {
    return res.render('reset-password', { valid: true, error: 'Passwords do not match.', token: req.params.token, passwordRules: PASSWORD_RULES });
  }
  if (!isValidPassword(password || '')) {
    return res.render('reset-password', { valid: true, error: PASSWORD_RULES, token: req.params.token, passwordRules: PASSWORD_RULES });
  }
  models.resetPasswordWithToken(req.params.token, password);
  res.render('login', { error: null, countryCodes: COUNTRY_CODES, resetSuccess: true });
});

module.exports = router;
