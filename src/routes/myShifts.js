const express = require('express');
const router = express.Router();
const models = require('../models');
const { toDateStr, todayStr } = require('../dateUtils');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

router.get('/', (req, res) => {
  const from = todayStr();
  const to = addDays(from, 27); // next 4 weeks
  const days = models.getUserUpcomingShifts(req.session.userId, from, to);
  res.render('my-shifts', { days, dayNames: DAY_NAMES, from, to });
});

module.exports = router;
