const express = require('express');
const router = express.Router();
const models = require('../models');
const { todayStr } = require('../dateUtils');

// Pairs up sequential clock_in/clock_out and break_start/break_end entries
// (oldest first) to estimate total worked minutes and total break minutes
// for whatever slice of entries is passed in. An unmatched trailing
// clock_in/break_start (still ongoing) counts up to "now".
function summarize(entries) {
  const chronological = entries.slice().reverse(); // listClockEntries returns newest-first
  let workedMs = 0;
  let breakMs = 0;
  let openWorkStart = null;
  let openBreakStart = null;

  for (const e of chronological) {
    const t = new Date(e.at).getTime();
    if (e.action === 'clock_in') {
      openWorkStart = t;
    } else if (e.action === 'clock_out') {
      if (openWorkStart) { workedMs += t - openWorkStart; openWorkStart = null; }
    } else if (e.action === 'break_start') {
      openBreakStart = t;
    } else if (e.action === 'break_end') {
      if (openBreakStart) { breakMs += t - openBreakStart; openBreakStart = null; }
    }
  }
  if (openWorkStart) workedMs += Date.now() - openWorkStart;
  if (openBreakStart) breakMs += Date.now() - openBreakStart;

  return {
    workedMinutes: Math.round(workedMs / 60000),
    breakMinutes: Math.round(breakMs / 60000)
  };
}

// For every completed shift (clock_in -> clock_out, for one user), works out
// that shift's total worked span and total break time taken within it, and
// attributes the result to the clock_out entry's id. Walks each user's full,
// unfiltered history (not just what's currently displayed) so a shift's
// numbers are still correct even if the clock_in falls outside the current
// date filter. Same elapsed-span-based definition of "worked" as summarize()
// above, so this always agrees with the summary table.
function buildShiftTotalsByEntryId(users) {
  const totalsByEntryId = {};
  users.forEach(u => {
    const chronological = models.listClockEntries({ userId: u.id }).slice().reverse(); // oldest first
    let workStart = null;
    let breakStart = null;
    let breakMs = 0;
    for (const e of chronological) {
      const t = new Date(e.at).getTime();
      if (e.action === 'clock_in') {
        workStart = t;
        breakMs = 0;
        breakStart = null;
      } else if (e.action === 'break_start') {
        breakStart = t;
      } else if (e.action === 'break_end') {
        if (breakStart) { breakMs += t - breakStart; breakStart = null; }
      } else if (e.action === 'clock_out') {
        if (workStart) {
          totalsByEntryId[e.id] = {
            workedMinutes: Math.round((t - workStart) / 60000),
            breakMinutes: Math.round(breakMs / 60000)
          };
        }
        workStart = null;
      }
    }
  });
  return totalsByEntryId;
}

router.get('/', (req, res) => {
  const { userId, from, to } = req.query;
  const users = models.listUsers();

  const fromIso = from ? new Date(from + 'T00:00:00').toISOString() : undefined;
  const toIso = to ? new Date(to + 'T23:59:59').toISOString() : undefined;

  const shiftTotalsByEntryId = buildShiftTotalsByEntryId(users);
  const entries = models.listClockEntries({ userId: userId || undefined, from: fromIso, to: toIso })
    .map(e => ({ ...e, shiftTotals: shiftTotalsByEntryId[e.id] || null }));

  // Per-staff summary for the selected range (defaults to today if no range given).
  const summaryFrom = from ? fromIso : new Date(todayStr() + 'T00:00:00').toISOString();
  const summaryTo = to ? toIso : undefined;
  const summary = users
    .filter(u => u.active)
    .map(u => {
      const userEntries = models.listClockEntries({ userId: u.id, from: summaryFrom, to: summaryTo });
      return { user: u, ...summarize(userEntries) };
    })
    .filter(s => s.workedMinutes > 0 || s.breakMinutes > 0);

  res.render('timesheets', {
    entries, users, summary,
    filterUserId: userId || '', filterFrom: from || '', filterTo: to || '',
    isRangeCustom: !!(from || to)
  });
});

module.exports = router;
