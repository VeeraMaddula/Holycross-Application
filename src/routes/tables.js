const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', (req, res) => {
  res.render('tables/list', { tables: models.getTablesWithStatus() });
});

// Lightweight JSON refresh so the status column (occupied/reserved/available)
// stays live without a full page reload — same pattern as the dashboard's
// "Who's working now" auto-refresh.
router.get('/status', (req, res) => {
  const statuses = models.getTablesWithStatus().map(t => ({
    id: t.id,
    status: t.status,
    statusLabel: t.statusLabel
  }));
  res.json(statuses);
});

router.post('/', (req, res) => {
  models.createTable(req.body);
  res.redirect('/tables');
});

router.post('/:id/delete', (req, res) => {
  models.deleteTable(req.params.id);
  res.redirect('/tables');
});

module.exports = router;
