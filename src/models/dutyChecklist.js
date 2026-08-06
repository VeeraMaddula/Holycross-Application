// Bar Staff Duties checklist — one tick-list per calendar day (the same 4
// sections every day, defined statically in ../duties.js) — whoever's on
// shift ticks tasks off as they go, and the list quietly resets itself each
// new day since completions are keyed by date rather than ever being
// "cleared." Also covers the scheduled-window escalation reports (opening/
// closing checks that ran late or incomplete).
const { readDb, writeDb } = require('../db');
const { toDateStr } = require('../dateUtils');
const { DUTY_SECTIONS, TASK_COUNT } = require('../duties');
const dutyWindows = require('../dutyWindows');
const { listAllStaffStatus } = require('./clockEntries');

// Everything ticked off on a given date, e.g. { 'opening-3': { completedByName, completedAt }, ... }
function getDutyCompletionsForDate(date) {
  const db = readDb();
  const map = {};
  (db.dutyCompletions || []).filter(c => c.date === date).forEach(c => {
    map[c.taskId] = { completedByUserId: c.completedByUserId, completedByName: c.completedByName, completedAt: c.completedAt };
  });
  return map;
}

// The full 4-section checklist for a date, with each task's done/who/when
// merged in, plus overall + per-section progress counts — everything the
// duties view needs in one call.
function getDutiesChecklist(date) {
  const completions = getDutyCompletionsForDate(date);
  let doneCount = 0;
  const sections = DUTY_SECTIONS.map(section => {
    const tasks = section.tasks.map(t => {
      const done = completions[t.id];
      if (done) doneCount++;
      return { ...t, done: !!done, completedByName: done ? done.completedByName : '', completedAt: done ? done.completedAt : null };
    });
    const sectionDone = tasks.filter(t => t.done).length;
    return { key: section.key, title: section.title, tasks, doneCount: sectionDone, totalCount: tasks.length };
  });
  return { date, sections, doneCount, totalCount: TASK_COUNT };
}

// Ticks a task on, or unticks it if it was already done — a plain toggle,
// same as every other checkbox-style control in this app.
function toggleDutyTask({ date, taskId, userId, userName }) {
  const db = readDb();
  if (!db.dutyCompletions) db.dutyCompletions = [];
  const existingIndex = db.dutyCompletions.findIndex(c => c.date === date && c.taskId === taskId);
  if (existingIndex >= 0) {
    db.dutyCompletions.splice(existingIndex, 1);
  } else {
    db.dutyCompletions.push({
      date,
      taskId,
      completedByUserId: userId ? Number(userId) : null,
      completedByName: userName || 'Unknown',
      completedAt: new Date().toISOString()
    });
  }
  writeDb(db);
}

// Bar Staff currently on shift (clocked in or on break) right now — used to
// name who's accountable in a duties escalation email.
function getBarStaffOnShiftNames() {
  return listAllStaffStatus()
    .filter(s => s.user.role === 'bar_staff' && (s.status === 'clocked_in' || s.status === 'on_break'))
    .map(s => s.user.name);
}

// One record per (date, section) at most — the first thing to record a
// completion state "wins" for the day, whether that's a Bar Staff member
// tapping Submit or the automatic sweep/clock-out check finding the window
// over. A later manual submit can still attach a reason if the auto-check
// got there first without one. `isNewIncomplete` tells the caller (routes/
// notify.js) whether this call just created a fresh incomplete report that
// still needs emailing — recordDutyReport itself never sends anything, to
// keep this module free of any dependency on notify.js.
function recordDutyReport({ date, section, sectionTitle, complete, reason, missingTaskTexts, staffOnShiftNames, trigger, submittedByUserId, submittedByName, photoPath }) {
  const db = readDb();
  if (!db.dutyReports) db.dutyReports = [];
  let rec = db.dutyReports.find(r => r.date === date && r.section === section);
  if (rec) {
    let changed = false;
    if (reason && !rec.reason) { rec.reason = reason; changed = true; }
    if (submittedByUserId && !rec.submittedByUserId) { rec.submittedByUserId = Number(submittedByUserId); rec.submittedByName = submittedByName || ''; changed = true; }
    if (photoPath && !rec.photoPath) { rec.photoPath = photoPath; changed = true; }
    if (changed) {
      rec.updatedAt = new Date().toISOString();
      writeDb(db);
    }
    return { report: rec, isNewIncomplete: false };
  }
  if (!db.meta.nextDutyReportId) db.meta.nextDutyReportId = 1;
  rec = {
    id: db.meta.nextDutyReportId++,
    date,
    section,
    sectionTitle: sectionTitle || section,
    complete: !!complete,
    reason: reason || '',
    missingTaskTexts: missingTaskTexts || [],
    staffOnShiftNames: staffOnShiftNames || [],
    trigger: trigger || 'auto',
    submittedByUserId: submittedByUserId ? Number(submittedByUserId) : null,
    submittedByName: submittedByName || '',
    photoPath: photoPath || '',
    createdAt: new Date().toISOString()
  };
  db.dutyReports.push(rec);
  writeDb(db);
  return { report: rec, isNewIncomplete: !complete };
}

function getDutyReport(date, section) {
  const db = readDb();
  return (db.dutyReports || []).find(r => r.date === date && r.section === section) || null;
}

// Every duty report ever recorded (submitted or auto-swept), newest first —
// used by the manager-facing Logs page (src/routes/logs.js).
function listAllDutyReports() {
  const db = readDb();
  return (db.dutyReports || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// What the kiosk's duties tab should show right now: which section (if
// any) is in its scheduled window today, its checklist, and progress — or
// { active: false } if nothing's scheduled, or if today's occurrence of
// that section has already been reported (submitted or auto-closed), so it
// doesn't keep nagging for the rest of the day.
function getDutyPanelState(now = new Date()) {
  const win = dutyWindows.getWindowForNow(now);
  if (!win) return { active: false };
  const date = toDateStr(win.businessDate);
  if (getDutyReport(date, win.section)) return { active: false };
  const checklist = getDutiesChecklist(date);
  const sectionData = checklist.sections.find(s => s.key === win.section);
  if (!sectionData) return { active: false };
  return {
    active: true,
    section: win.section,
    sectionTitle: win.sectionTitle,
    date,
    tasks: sectionData.tasks,
    doneCount: sectionData.doneCount,
    totalCount: sectionData.totalCount
  };
}

module.exports = {
  getDutiesChecklist, toggleDutyTask, getDutyPanelState, recordDutyReport, getDutyReport, getBarStaffOnShiftNames,
  listAllDutyReports
};
