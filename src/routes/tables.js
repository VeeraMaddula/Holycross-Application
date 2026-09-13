const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', async (req, res) => {
  res.render('tables/list', { tables: await models.getTablesWithStatus() });
});

// Lightweight JSON refresh so the status column (occupied/reserved/available)
// stays live without a full page reload — same pattern as the dashboard's
// "Who's working now" auto-refresh.
router.get('/status', async (req, res) => {
  const statuses = (await models.getTablesWithStatus()).map(t => ({
    id: t.id,
    status: t.status,
    statusLabel: t.statusLabel
  }));
  res.json(statuses);
});

router.post('/', async (req, res) => {
  await models.createTable(req.body);
  res.redirect('/tables');
});

router.post('/:id/delete', async (req, res) => {
  await models.deleteTable(req.params.id);
  res.redirect('/tables');
});

module.exports = router;
