const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (password === adminPassword) {
    req.session.isAdmin = true;
    return res.redirect('/');
  }
  res.render('login', { error: 'Incorrect password.' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
