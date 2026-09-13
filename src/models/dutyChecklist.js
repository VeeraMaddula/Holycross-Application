// Bar Staff Duties checklist — one tick-list per calendar day (the same 4
// sections every day, defined statically in ../duties.js) — whoever's on
// shift ticks tasks off as they go, and the list quietly resets itself each
// new day since completions are keyed by date rather than ever being
// "cleared." Also covers the scheduled-window escalation reports (opening/
// closing checks that ran late or incomplete).
// SQL-backed as of task #209 — see db/012_redesign_duties_training.sql.
// Every exported function is now ASYNC.
const { toDateStr } = require('../dateUtils');
const { query } = require('../sqlPool');
const dutyTasks = require('./dutyTasks');
const dutyWindows = require('../dutyWindows');
const { listAllStaffStatus } = require('./clockEntries');

function mapReportRow(r) {
  return {
    id: r.id,
    date: r.date,
    section: r.section,
    sectionTitle: r.section_title,
    complete: r.complete,
    reason: r.reason,
    missingTaskTexts: r.missing_task_texts || [],
    staffOnShiftNames: r.staff_on_shift_names || [],
    trigger: r.trigger,
    submittedByUserId: r.submitted_by_user_id,
    submittedByName: r.submitted_by_name,
    photoPath: r.photo_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

// Everything ticked off on a given date, e.g. { 'opening-3': { completedByName, completedAt }, ... }
async function getDutyCompletionsForDate(date) {
  const { rows } = await query(`SELECT * FROM duty_completions WHERE date = $1`, [date]);
  const map = {};
  rows.forEach(c => {
    map[c.task_id] = { completedByUserId: c.completed_by_user_id, completedByName: c.completed_by_name, completedAt: c.completed_at };
  });
  return map;
}

// The full 4-section checklist for a date, with each task's done/who/when
// merged in, plus overall + per-section progress counts — everything the
// duties view needs in one call.
async function getDutiesChecklist(date) {
  const [completions, sectionDefs] = await Promise.all([getDutyCompletionsForDate(date), dutyTasks.getDutySections()]);
  let doneCount = 0;
  let totalCount = 0;
  const sections = sectionDefs.map(section => {
    const tasks = section.tasks.map(t => {
      const done = completions[t.id];
      if (done) doneCount++;
      totalCount++;
      return { ...t, done: !!done, completedByName: done ? done.completedByName : '', completedAt: done ? done.completedAt : null };
    });
    const sectionDone = tasks.filter(t => t.done).length;
    return { key: section.key, title: section.title, tasks, doneCount: sectionDone, totalCount: tasks.length };
  });
  return { date, sections, doneCount, totalCount };
}

// Ticks a task on, or unticks it if it was already done — a plain toggle,
// same as every other checkbox-style control in this app.
async function toggleDutyTask({ date, taskId, userId, userName }) {
  const { rowCount } = await query(`DELETE FROM duty_completions WHERE date = $1 AND task_id = $2`, [date, taskId]);
  if (rowCount) return;
  await query(
    `INSERT INTO duty_completions (date, task_id, completed_by_user_id, completed_by_name) VALUES ($1, $2, $3, $4)`,
    [date, taskId, userId ? Number(userId) : null, userName || 'Unknown']
  );
}

// Bar Staff currently on shift (clocked in or on break) right now — used to
// name who's accountable in a duties escalation email.
async function getBarStaffOnShiftNames() {
  const staff = await listAllStaffStatus();
  return staff
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
async function recordDutyReport({ date, section, sectionTitle, complete, reason, missingTaskTexts, staffOnShiftNames, trigger, submittedByUserId, submittedByName, photoPath }) {
  const { rows: existingRows } = await query(`SELECT * FROM duty_reports WHERE date = $1 AND section = $2`, [date, section]);
  if (existingRows.length) {
    const rec = existingRows[0];
    const sets = [];
    const params = [];
    let i = 1;
    if (reason && !rec.reason) { sets.push(`reason = $${i++}`); params.push(reason); }
    if (submittedByUserId && !rec.submitted_by_user_id) {
      sets.push(`submitted_by_user_id = $${i++}`); params.push(Number(submittedByUserId));
      sets.push(`submitted_by_name = $${i++}`); params.push(submittedByName || '');
    }
    if (photoPath && !rec.photo_path) { sets.push(`photo_path = $${i++}`); params.push(photoPath); }
    if (sets.length) {
      sets.push(`updated_at = now()`);
      params.push(rec.id);
      const { rows } = await query(`UPDATE duty_reports SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
      return { report: mapReportRow(rows[0]), isNewIncomplete: false };
    }
    return { report: mapReportRow(rec), isNewIncomplete: false };
  }

  const { rows } = await query(
    `INSERT INTO duty_reports (date, section, section_title, complete, reason, missing_task_texts, staff_on_shift_names, trigger, submitted_by_user_id, submitted_by_name, photo_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (date, section) DO NOTHING RETURNING *`,
    [
      date, section, sectionTitle || section, !!complete, reason || '',
      JSON.stringify(missingTaskTexts || []), JSON.stringify(staffOnShiftNames || []),
      trigger || 'auto', submittedByUserId ? Number(submittedByUserId) : null, submittedByName || '', photoPath || ''
    ]
  );
  if (rows.length) return { report: mapReportRow(rows[0]), isNewIncomplete: !complete };
  // Lost a race with a concurrent insert for the same (date, section) —
  // fetch whatever won instead of erroring.
  const { rows: raceRows } = await query(`SELECT * FROM duty_reports WHERE date = $1 AND section = $2`, [date, section]);
  return { report: mapReportRow(raceRows[0]), isNewIncomplete: false };
}

async function getDutyReport(date, section) {
  const { rows } = await query(`SELECT * FROM duty_reports WHERE date = $1 AND section = $2`, [date, section]);
  return rows[0] ? mapReportRow(rows[0]) : null;
}

// Every duty report ever recorded (submitted or auto-swept), newest first —
// used by the manager-facing Logs page (src/routes/logs.js).
async function listAllDutyReports() {
  const { rows } = await query(`SELECT * FROM duty_reports ORDER BY created_at DESC`);
  return rows.map(mapReportRow);
}

// What the kiosk's duties tab should show right now: which section (if
// any) is in its scheduled window today, its checklist, and progress — or
// { active: false } if nothing's scheduled, or if today's occurrence of
// that section has already been reported (submitted or auto-closed), so it
// doesn't keep nagging for the rest of the day.
async function getDutyPanelState(now = new Date()) {
  const win = dutyWindows.getWindowForNow(now);
  if (!win) return { active: false };
  const date = toDateStr(win.businessDate);
  if (await getDutyReport(date, win.section)) return { active: false };
  const checklist = await getDutiesChecklist(date);
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
