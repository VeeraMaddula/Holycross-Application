const express = require('express');
const router = express.Router();
const models = require('../models');

// Read-only, public "virtual menu" — linked from booking confirmation
// emails/texts so a customer can see what's on before they arrive. No
// login required; this never lets a visitor change anything, unlike the
// staff-only /menu admin page.
router.get('/', (req, res) => {
  res.render('public/menu', { menu: models.getMenu() });
});

module.exports = router;
