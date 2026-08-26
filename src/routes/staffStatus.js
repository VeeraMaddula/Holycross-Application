const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', async (req, res) => {
  const staff = await models.listAllStaffStatus();
  res.render('staff-status', { staff });
});

// Lightweight JSON endpoint the page polls to auto-refresh without a full reload.
router.get('/data', async (req, res) => {
  res.json(await models.listAllStaffStatus());
});

module.exports = router;
