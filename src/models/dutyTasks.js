// Bar Staff Duties task DEFINITIONS — which tasks exist in each section
// (Opening/After Breakfast/After Carvery/Closing). Separate from
// dutyChecklist.js, which only handles day-to-day tick/report state.
// SQL-backed as of task #209 — see db/012_redesign_duties_training.sql.
// Starts from the DEFAULT_DUTY_SECTIONS seed in ../duties.js, copied into
// the database the first time anyone reads it, so managers can add, edit,
// or remove tasks from the Duties page without touching code. Section
// keys/titles stay fixed (they're tied to the schedule in dutyWindows.js)
// — only the task list inside each section is editable. Every exported
// function is now ASYNC.
const { query } = require('../sqlPool');
const { DEFAULT_DUTY_SECTIONS } = require('../duties');

function mapSectionRow(r) {
  return { key: r.key, title: r.title, tasks: r.tasks || [] };
}

// Copies the default seed into duty_sections the first time it's empty
// (fresh install, or right after a factory reset) — returns the live rows
// either way.
async function ensureSeeded() {
  const { rows } = await query(`SELECT * FROM duty_sections ORDER BY id ASC`);
  if (rows.length) return rows;
  for (const section of DEFAULT_DUTY_SECTIONS) {
    await query(
      `INSERT INTO duty_sections (key, title, tasks) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
      [section.key, section.title, JSON.stringify(section.tasks)]
    );
  }
  const { rows: seeded } = await query(`SELECT * FROM duty_sections ORDER BY id ASC`);
  return seeded;
}

async function getDutySections() {
  const rows = await ensureSeeded();
  return rows.map(mapSectionRow);
}

async function addDutyTask(sectionKey, text) {
  await ensureSeeded();
  const clean = (text || '').trim();
  if (!clean) return { error: 'Task text is required.' };
  const { rows } = await query(`SELECT * FROM duty_sections WHERE key = $1`, [sectionKey]);
  if (!rows.length) return { error: 'Unknown duties section.' };
  const section = rows[0];
  const tasks = section.tasks || [];
  // Custom-added tasks get their own id namespace so they never collide
  // with the seeded ids (opening-1, breakfast-1, etc.) even after several
  // rounds of adding/deleting — a simple max-suffix-seen-plus-one per
  // section, since there's no shared counter to draw from anymore.
  const customNums = tasks
    .map(t => String(t.id).match(new RegExp(`^${sectionKey}-custom-(\\d+)$`)))
    .filter(Boolean)
    .map(m => Number(m[1]));
  const nextNum = customNums.length ? Math.max(...customNums) + 1 : 1;
  const id = `${sectionKey}-custom-${nextNum}`;
  const task = { id, text: clean };
  tasks.push(task);
  await query(`UPDATE duty_sections SET tasks = $1 WHERE key = $2`, [JSON.stringify(tasks), sectionKey]);
  return { task };
}

async function updateDutyTask(taskId, text) {
  const clean = (text || '').trim();
  if (!clean) return { error: 'Task text is required.' };
  const sections = await ensureSeeded();
  for (const section of sections) {
    const tasks = section.tasks || [];
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      task.text = clean;
      await query(`UPDATE duty_sections SET tasks = $1 WHERE key = $2`, [JSON.stringify(tasks), section.key]);
      return { task };
    }
  }
  return { error: 'Task not found.' };
}

// Only removes the task DEFINITION — any ticks already recorded for today
// (duty_completions) or past duty_reports snapshots are left alone; they
// keep whatever text the task had at the time, same reasoning as editing.
async function deleteDutyTask(taskId) {
  const sections = await ensureSeeded();
  for (const section of sections) {
    const tasks = section.tasks || [];
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx >= 0) {
      tasks.splice(idx, 1);
      await query(`UPDATE duty_sections SET tasks = $1 WHERE key = $2`, [JSON.stringify(tasks), section.key]);
      return { ok: true };
    }
  }
  return { error: 'Task not found.' };
}

module.exports = { getDutySections, addDutyTask, updateDutyTask, deleteDutyTask };
