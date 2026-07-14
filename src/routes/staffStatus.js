const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', (req, res) => {
  const staff = models.listAllStaffStatus();
  res.render('staff-status', { staff });
});

// Lightweight JSON endpoint the page polls to auto-refresh without a full reload.
router.get('/data', (req, res) => {
  res.json(models.listAllStaffStatus());
});

module.exports = router;
