const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', (req, res) => {
  res.render('tables/list', { tables: models.listTables() });
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
