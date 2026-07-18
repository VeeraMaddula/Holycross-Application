const express = require('express');
const router = express.Router();
const models = require('../models');
const { todayStr } = require('../dateUtils');

// Defaults to today; a date query param lets anyone flip back and check a
// previous day's list (e.g. a manager reviewing yesterday's closing).
router.get('/', (req, res) => {
  const date = req.query.date || todayStr();
  const checklist = models.getDutiesChecklist(date);
  res.render('duties', { checklist, today: todayStr() });
});

router.post('/toggle', (req, res) => {
  const { date, taskId } = req.body;
  const u = res.locals.currentUser;
  if (date && taskId) {
    models.toggleDutyTask({ date, taskId, userId: u && u.id, userName: u && u.name });
  }
  res.redirect(`/duties?date=${encodeURIComponent(date || '')}`);
});

module.exports = router;
