const express = require('express');
const router = express.Router();
const models = require('../models');
const { STAFF_PRIVACY_VERSION, STAFF_PRIVACY_SECTIONS, CONTROLLER_NAME } = require('../privacyPolicy');

// Also reachable any time (not just when the gate redirects here) via a
// "Privacy Policy" sidebar link, so staff can review it whenever they like.
router.get('/accept-privacy', (req, res) => {
  const u = res.locals.currentUser;
  const alreadyCurrent = u && u.privacyPolicyVersionRaw === STAFF_PRIVACY_VERSION;
  const returnTo = (req.query.returnTo && String(req.query.returnTo).startsWith('/')) ? req.query.returnTo : '/';
  res.render('privacy-accept', {
    sections: STAFF_PRIVACY_SECTIONS,
    controllerName: CONTROLLER_NAME,
    version: STAFF_PRIVACY_VERSION,
    alreadyCurrent,
    acceptedAt: u ? u.privacyPolicyAcceptedAtRaw : null,
    returnTo
  });
});

router.post('/accept-privacy', (req, res) => {
  const u = res.locals.currentUser;
  if (u) models.acceptPrivacyPolicy(u.id, STAFF_PRIVACY_VERSION);
  res.redirect(req.body.returnTo && req.body.returnTo.startsWith('/') ? req.body.returnTo : '/');
});

module.exports = router;
