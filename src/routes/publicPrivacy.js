const express = require('express');
const router = express.Router();
const { CUSTOMER_PRIVACY_SECTIONS, CONTROLLER_NAME } = require('../privacyPolicy');

// Public, unauthenticated privacy notice — linked from the booking form's
// required acknowledgment checkbox. Read-only, no login needed.
router.get('/', (req, res) => {
  res.render('public/privacy', { sections: CUSTOMER_PRIVACY_SECTIONS, controllerName: CONTROLLER_NAME });
});

module.exports = router;
