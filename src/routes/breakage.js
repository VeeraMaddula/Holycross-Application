const express = require('express');
const router = express.Router();
const models = require('../models');

// Reports are created from the kiosk clock-out prompt (see
// src/routes/kiosk.js's POST /kiosk/breakage) — this router is read-only:
// the report list plus the "who's breaking/losing more stock" summary, for
// senior/general managers, admin, and the accountant role.
router.get('/', async (req, res) => {
  const [reports, byUser] = await Promise.all([
    models.listBreakageReports(),
    models.getBreakageCountsByUser()
  ]);
  res.render('breakage', {
    reports,
    byUser,
    categoryLabels: models.BREAKAGE_CATEGORY_LABELS
  });
});

module.exports = router;
