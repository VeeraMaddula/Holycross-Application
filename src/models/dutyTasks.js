// Bar Staff Duties task DEFINITIONS — which tasks exist in each section
// (Opening/After Breakfast/After Carvery/Closing). Separate from
// dutyChecklist.js, which only handles day-to-day tick/report state.
// Starts from the DEFAULT_DUTY_SECTIONS seed in ../duties.js, copied into
// the database the first time anyone reads it, so managers can add, edit,
// or remove tasks from the Duties page without touching code. Section
// keys/titles stay fixed (they're tied to the schedule in dutyWindows.js)
// — only the task list inside each section is editable.
const { readDb, writeDb } = require('../db');
const { DEFAULT_DUTY_SECTIONS } = require('../duties');

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

// Copies the default seed into db.dutySections the first time it's empty
// (fresh install, or right after a factory reset) — returns the live array
// either way, on the same `db` object the caller already has open.
function ensureSeeded(db) {
  if (!db.dutySections || !db.dutySections.length) {
    db.dutySections = clone(DEFAULT_DUTY_SECTIONS);
    writeDb(db);
  }
  return db.dutySections;
}

function getDutySections() {
  const db = readDb();
  return ensureSeeded(db);
}

function addDutyTask(sectionKey, text) {
  const db = readDb();
  ensureSeeded(db);
  const section = db.dutySections.find(s => s.key === sectionKey);
  if (!section) return { error: 'Unknown duties section.' };
  const clean = (text || '').trim();
  if (!clean) return { error: 'Task text is required.' };
  if (!db.meta.nextDutyTaskSeq) db.meta.nextDutyTaskSeq = 1;
  // Custom-added tasks get their own id namespace so they never collide
  // with the seeded ids (opening-1, breakfast-1, etc.) even after several
  // rounds of adding/deleting.
  const id = `${sectionKey}-custom-${db.meta.nextDutyTaskSeq++}`;
  const task = { id, text: clean };
  section.tasks.push(task);
  writeDb(db);
  return { task };
}

function updateDutyTask(taskId, text) {
  const db = readDb();
  ensureSeeded(db);
  const clean = (text || '').trim();
  if (!clean) return { error: 'Task text is required.' };
  for (const section of db.dutySections) {
    const task = section.tasks.find(t => t.id === taskId);
    if (task) {
      task.text = clean;
      writeDb(db);
      return { task };
    }
  }
  return { error: 'Task not found.' };
}

// Only removes the task DEFINITION — any ticks already recorded for today
// (db.dutyCompletions) or past dutyReports snapshots are left alone; they
// keep whatever text the task had at the time, same reasoning as editing.
function deleteDutyTask(taskId) {
  const db = readDb();
  ensureSeeded(db);
  for (const section of db.dutySections) {
    const idx = section.tasks.findIndex(t => t.id === taskId);
    if (idx >= 0) {
      section.tasks.splice(idx, 1);
      writeDb(db);
      return { ok: true };
    }
  }
  return { error: 'Task not found.' };
}

module.exports = { getDutySections, addDutyTask, updateDutyTask, deleteDutyTask };
