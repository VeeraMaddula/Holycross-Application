const express = require('express');
const router = express.Router();
const models = require('../models');

// Read-only, public "virtual menu" — linked from booking confirmation
// emails/texts so a customer can see what's on before they arrive. No
// login required; this never lets a visitor change anything, unlike the
// staff-only /menu admin page.
router.get('/', async (req, res) => {
  res.render('public/menu', { menu: await models.getMenu() });
});

module.exports = router;
