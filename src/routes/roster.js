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
  const shiftWithArea = { ...shift, areaLabel: models.ROSTER_AREA_LABELS[shift.area] || '' };
  if (user.email) {
    const { subject, text } = emailFn(shiftWithArea, user.name);
    notify.sendEmail({ to: user.email, subject, text, type });
  }
  if (user.phone) {
    sms.sendSms({ to: user.phone, body: smsFn(shiftWithArea), type });
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

router.get('/week', async (req, res) => {
  const weekStart = mondayOf(req.query.week || todayStr());
  const weekEnd = addDays(weekStart, 6);
  const users = (await models.listUsers()).filter(u => u.active);
  const days = (await models.getResolvedScheduleForRange(weekStart, weekEnd))
    .map(day => ({
      ...day,
      shifts: day.shifts.map(withBarPosition),
      pendingCount: day.shifts.filter(s => !s.notified).length
    }));
  const orphanedCount = days.reduce((sum, day) => sum + day.shifts.filter(s => s.userName === 'Unknown staff').length, 0);
  const weekPendingCount = days.reduce((sum, day) => sum + day.pendingCount, 0);
  const currentUser = res.locals.currentUser;
  const canCleanUp = !!(currentUser && (currentUser.role === 'admin' || currentUser.role === 'senior_manager'));

  res.render('roster-week', {
    users,
    days,
    dayNames: DAY_NAMES,
    weekStart, weekEnd,
    prevWeek: addDays(weekStart, -7),
    nextWeek: addDays(weekStart, 7),
    thisWeek: mondayOf(todayStr()),
    formatTime12,
    areas: models.ROSTER_AREAS,
    areaLabels: models.ROSTER_AREA_LABELS,
    orphanedCount, canCleanUp, weekPendingCount,
    justCleaned: req.query.cleaned !== undefined ? Number(req.query.cleaned) : null
  });
});

// Lightweight refresh for the weekly overview table — same live-poll pattern
// used on the Dashboard/Tables/Kiosk pages, so if a shift is added or edited
// from another device the table catches up without a manual reload.
router.get('/week/data', async (req, res) => {
  const weekStart = mondayOf(req.query.week || todayStr());
  const weekEnd = addDays(weekStart, 6);
  const days = await models.getResolvedScheduleForRange(weekStart, weekEnd);
  const shifts = [];
  days.forEach(day => {
    day.shifts.forEach(s => {
      shifts.push({
        id: s.id, userId: s.userId, date: day.date, startTime: s.startTime, endTime: s.endTime, color: s.color,
        startLabel: formatTime12(s.startTime), endLabel: formatTime12(s.endTime),
        area: s.area || '', areaLabel: s.areaLabel || '', notified: !!s.notified
      });
    });
  });
  res.json({ shifts });
});

// Saves one or more shift rows for a single day in one submit — the day
// form on roster-week.ejs lets a manager add several staff/area/time rows
// before hitting one Save, rather than round-tripping per staff member.
// Fields arrive as same-length arrays (userId[], area[], startTime[],
// endTime[]) — express's urlencoded parser (extended:true, i.e. qs) turns
// repeated `name[]` fields into an array automatically, in the order the
// browser submitted them, so index i across all four arrays always
// describes one row. Nothing is notified here — see POST /notify below.
router.post('/shifts/batch', async (req, res) => {
  const { date, redirectWeek } = req.body;
  const userIds = [].concat(req.body.userId || []);
  const areasIn = [].concat(req.body.area || []);
  const startTimes = [].concat(req.body.startTime || []);
  const endTimes = [].concat(req.body.endTime || []);

  if (date) {
    for (let i = 0; i < userIds.length; i++) {
      if (userIds[i] && startTimes[i] && endTimes[i]) {
        await models.addRosterShift({ date, userId: userIds[i], startTime: startTimes[i], endTime: endTimes[i], area: areasIn[i] });
      }
    }
  }
  res.redirect('/roster/week' + (redirectWeek ? `?week=${redirectWeek}` : ''));
});

router.post('/shifts/:id/edit', async (req, res) => {
  const { date, startTime, endTime, area, redirectWeek } = req.body;
  await models.updateRosterShift(req.params.id, { date, startTime, endTime, area });
  res.redirect('/roster/week' + (redirectWeek ? `?week=${redirectWeek}` : ''));
});

router.post('/shifts/:id/delete', (req, res) => {
  models.removeRosterShift(req.params.id);
  res.redirect('/roster/week' + (req.body.redirectWeek ? `?week=${req.body.redirectWeek}` : ''));
});

// Sends the "shift assigned"/"shift updated" email+SMS for every shift on
// one date that hasn't been notified yet, then marks them notified — the
// day's "Send notifications" button on roster-week.ejs. Deliberately
// manager-triggered rather than automatic, so a manager can build out a
// whole day's roster first and only ping staff once it's final.
router.post('/notify', async (req, res) => {
  const { date, redirectWeek } = req.body;
  if (date) {
    const pending = await models.getPendingNotificationsForRange(date, date);
    pending.forEach(shift => notifyShift(shift, shift.pendingAction === 'updated' ? 'updated' : 'assigned'));
    models.markShiftsNotifiedForRange(date, date);
  }
  res.redirect('/roster/week' + (redirectWeek ? `?week=${redirectWeek}` : ''));
});

// Same as above but for the whole week in view — the roster is built one
// week at a time, so this is the main button for "I've finished this
// week's roster, tell everyone now" rather than pressing each day's
// button separately.
router.post('/notify-week', async (req, res) => {
  const { weekStart: weekStartIn, redirectWeek } = req.body;
  const weekStart = mondayOf(weekStartIn || todayStr());
  const weekEnd = addDays(weekStart, 6);
  const pending = await models.getPendingNotificationsForRange(weekStart, weekEnd);
  pending.forEach(shift => notifyShift(shift, shift.pendingAction === 'updated' ? 'updated' : 'assigned'));
  models.markShiftsNotifiedForRange(weekStart, weekEnd);
  res.redirect('/roster/week' + (redirectWeek ? `?week=${redirectWeek}` : ''));
});

// One-off maintenance action: removes any shift whose staff member no
// longer exists (shows up as "Unknown staff" — leftover from the JSON
// roster file predating the move to the CockroachDB users table, see
// models/roster.js's removeOrphanedShifts). Restricted to admin/senior
// manager, same bar as the sidebar's Danger Zone actions, since it's a
// bulk delete even though what it deletes is already broken data.
router.post('/cleanup-orphaned', async (req, res) => {
  const u = res.locals.currentUser;
  if (!u || (u.role !== 'admin' && u.role !== 'senior_manager')) {
    return res.status(403).render('403');
  }
  const removed = await models.removeOrphanedShifts();
  const redirectWeek = req.body.redirectWeek;
  res.redirect('/roster/week' + (redirectWeek ? `?week=${redirectWeek}&cleaned=${removed}` : `?cleaned=${removed}`));
});

module.exports = router;
