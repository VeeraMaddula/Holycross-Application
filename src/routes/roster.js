const express = require('express');
const router = express.Router();
const models = require('../models');
const { toDateStr, todayStr, formatTime12 } = require('../dateUtils');
const notify = require('../notify');
const sms = require('../sms');

// Notifies the assigned staff member by email + SMS that a shift was added
// or updated. Fire-and-forget, same pattern as bookings.js — sendEmail/
// sendSms log their own outcome (including "skipped" when unconfigured) and
// never throw, so this never blocks the response.
function notifyShift(shift, kind) {
  const user = shift.user;
  if (!user) return;
  const emailFn = kind === 'updated' ? notify.shiftUpdatedEmail : notify.shiftAssignedEmail;
  const smsFn = kind === 'updated' ? sms.shiftUpdatedSms : sms.shiftAssignedSms;
  const type = kind === 'updated' ? 'shift-updated' : 'shift-assigned';
  if (user.email) {
    const { subject, text } = emailFn(shift, user.name);
    notify.sendEmail({ to: user.email, subject, text, type });
  }
  if (user.phone) {
    sms.sendSms({ to: user.phone, body: smsFn(shift), type });
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

// Position/width (as % of a 24h-wide bar) for a start/end time pair, for
// drawing the coloured block on the timeline. Overnight shifts (end <= start)
// are visually clipped to midnight on this day's bar.
function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function withBarPosition(shift) {
  const startMin = toMinutes(shift.startTime);
  let endMin = toMinutes(shift.endTime);
  if (endMin <= startMin) endMin = 24 * 60;
  return {
    ...shift,
    leftPct: (startMin / 1440) * 100,
    widthPct: Math.max(((endMin - startMin) / 1440) * 100, 1)
  };
}

// ---- Single roster page: assign staff directly to specific dates. No
// recurring weekly pattern — shifts change too often for that to be useful,
// so every week is edited on its own. ----
router.get('/', (req, res) => res.redirect('/roster/week'));

router.get('/week', (req, res) => {
  const weekStart = mondayOf(req.query.week || todayStr());
  const weekEnd = addDays(weekStart, 6);
  const users = models.listUsers().filter(u => u.active);
  const days = models.getResolvedScheduleForRange(weekStart, weekEnd)
    .map(day => ({ ...day, shifts: day.shifts.map(withBarPosition) }));

  res.render('roster-week', {
    users,
    days,
    dayNames: DAY_NAMES,
    weekStart, weekEnd,
    prevWeek: addDays(weekStart, -7),
    nextWeek: addDays(weekStart, 7),
    thisWeek: mondayOf(todayStr()),
    formatTime12
  });
});

// Lightweight refresh for the weekly overview table — same live-poll pattern
// used on the Dashboard/Tables/Kiosk pages, so if a shift is added or edited
// from another device the table catches up without a manual reload.
router.get('/week/data', (req, res) => {
  const weekStart = mondayOf(req.query.week || todayStr());
  const weekEnd = addDays(weekStart, 6);
  const days = models.getResolvedScheduleForRange(weekStart, weekEnd);
  const shifts = [];
  days.forEach(day => {
    day.shifts.forEach(s => {
      shifts.push({
        id: s.id, userId: s.userId, date: day.date, startTime: s.startTime, endTime: s.endTime, color: s.color,
        startLabel: formatTime12(s.startTime), endLabel: formatTime12(s.endTime)
      });
    });
  });
  res.json({ shifts });
});

router.post('/shifts', (req, res) => {
  const { date, userId, startTime, endTime, redirectWeek } = req.body;
  if (date && userId && startTime && endTime) {
    const result = models.addRosterShift({ date, userId, startTime, endTime });
    notifyShift(result.shift, 'assigned');
  }
  res.redirect('/roster/week' + (redirectWeek ? `?week=${redirectWeek}` : ''));
});

router.post('/shifts/:id/edit', (req, res) => {
  const { date, startTime, endTime, redirectWeek } = req.body;
  const result = models.updateRosterShift(req.params.id, { date, startTime, endTime });
  if (!result.error) {
    notifyShift(result.shift, 'updated');
  }
  res.redirect('/roster/week' + (redirectWeek ? `?week=${redirectWeek}` : ''));
});

router.post('/shifts/:id/delete', (req, res) => {
  models.removeRosterShift(req.params.id);
  res.redirect('/roster/week' + (req.body.redirectWeek ? `?week=${req.body.redirectWeek}` : ''));
});

module.exports = router;
