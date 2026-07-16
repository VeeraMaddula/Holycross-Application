const express = require('express');
const router = express.Router();
const models = require('../models');
const { toDateStr, todayStr, formatTime12 } = require('../dateUtils');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

router.get('/', (req, res) => {
  const from = todayStr();
  const to = addDays(from, 27); // next 4 weeks, just this person's own shifts
  const days = models.getUserUpcomingShifts(req.session.userId, from, to);

  // Same "week at a glance" the Roster page shows managers — everyone on
  // shift, Mon-Sun, at a glance — just without the add/edit controls, since
  // regular staff can look but not touch. Roster's own /roster/week/data is
  // gated behind requireRosterAccess (most staff don't have it), so this
  // page gets its own read-only data route below.
  const weekStart = mondayOf(req.query.week || todayStr());
  const weekEnd = addDays(weekStart, 6);
  const teamUsers = models.listUsers().filter(u => u.active);
  const teamDays = models.getResolvedScheduleForRange(weekStart, weekEnd);

  res.render('my-shifts', {
    days, dayNames: DAY_NAMES, from, to, formatTime12,
    teamUsers, teamDays,
    weekStart, weekEnd,
    prevWeek: addDays(weekStart, -7),
    nextWeek: addDays(weekStart, 7),
    thisWeek: mondayOf(todayStr())
  });
});

// Lightweight refresh for the team overview table, same live-poll pattern as
// the Roster page's own version — kept as a separate route (rather than
// reusing /roster/week/data) because that one requires roster-management
// access, which most staff viewing My Shifts won't have.
router.get('/week/data', (req, res) => {
  const weekStart = mondayOf(req.query.week || todayStr());
  const weekEnd = addDays(weekStart, 6);
  const days = models.getResolvedScheduleForRange(weekStart, weekEnd);
  const shifts = [];
  days.forEach(day => {
    day.shifts.forEach(s => {
      shifts.push({
        id: s.id, userId: s.userId, date: day.date, color: s.color,
        startLabel: formatTime12(s.startTime), endLabel: formatTime12(s.endTime)
      });
    });
  });
  res.json({ shifts });
});

module.exports = router;
