// One-time data migration — copies the existing JSON notifications/
// dutySections/dutyCompletions/dutyReports/trainingItems/settings/menu/
// events (data/db.json, via src/db.js's readDb()) into their new SQL
// tables, now that models/notificationsLog.js, models/dutyTasks.js,
// models/dutyChecklist.js, models/trainingResources.js, models/settings.js,
// and models/menu.js are all SQL-backed (task #209).
//
// IMPORTANT — where to run this: same as every other migrate-*.js script
// this session — it only finds real data when data/db.json is the ACTUAL
// production file, which only exists inside the running Render service
// (see src/persist.js). Run this from a Render Shell session for
// holycross-booking, NOT from a local machine, and only AFTER
// apply-redesign-duties-training.js has already been run (it creates/
// recreates duty_sections/duty_completions/duty_reports/training_items
// with the columns this script writes to).
// Usage (in the Render Shell): node migrate-duties-training-notifications-settings-menu-data.js
//
// Preserves every original numeric id exactly as it was in JSON, where ids
// exist (notifications, dutyReports, trainingItems). Safe to re-run: every
// insert is ON CONFLICT DO NOTHING. Duty completions/sections have no
// original numeric id to preserve (completions are keyed by (date,task_id),
// sections by `key`) so those use their own natural-key ON CONFLICT target.
// A dutyReport/trainingItem/duty_completion whose user reference
// (completedByUserId/submittedByUserId/createdByUserId) no longer matches a
// real user is retried with that one column nulled rather than dropped —
// these are historical records worth keeping even if the person behind
// them left.
require('dotenv').config();
const { readDb } = require('./src/db');
const { query, getPool } = require('./src/sqlPool');
const { DEFAULT_DUTY_SECTIONS } = require('./src/duties');

async function insertWithOrphanRetry(sql, params, nullableUserIndexes) {
  try {
    const { rowCount } = await query(sql, params);
    return rowCount ? 'inserted' : 'already-present';
  } catch (err) {
    if (err.code === '23503' && nullableUserIndexes.length) {
      const retryParams = params.slice();
      for (const i of nullableUserIndexes) retryParams[i] = null;
      const { rowCount } = await query(sql, retryParams);
      return rowCount ? 'inserted (orphaned user ref nulled)' : 'already-present';
    }
    throw err;
  }
}

async function migrateNotifications(db) {
  const notifications = db.notifications || [];
  const tally = {};
  for (const n of notifications) {
    const { rowCount } = await query(
      `INSERT INTO notifications (id, type, booking_id, recipient, subject, text, status, error, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [n.id, n.type, n.bookingId || null, n.recipient || null, n.subject || null, n.text || null, n.status || 'sent', n.error || null, n.sentAt || new Date().toISOString()]
    );
    const key = rowCount ? 'inserted' : 'already-present';
    tally[key] = (tally[key] || 0) + 1;
  }
  console.log(`Notifications — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
  if (notifications.length) await query(`SELECT setval(pg_get_serial_sequence('notifications', 'id'), COALESCE((SELECT MAX(id) FROM notifications), 1))`);
}

// Sections/tasks: dutyTasks.js's ensureSeeded() would seed these from
// DEFAULT_DUTY_SECTIONS automatically on first read anyway, but we migrate
// explicitly from the live JSON (not the code default) in case a manager
// has since edited/added/removed tasks via the Duties page — whatever is
// in db.json's dutySections right now is the real, current task list.
async function migrateDutySections(db) {
  const sections = db.dutySections && db.dutySections.length ? db.dutySections : DEFAULT_DUTY_SECTIONS;
  const tally = {};
  for (const s of sections) {
    const { rowCount } = await query(
      `INSERT INTO duty_sections (key, title, tasks) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, tasks = EXCLUDED.tasks`,
      [s.key, s.title, JSON.stringify(s.tasks || [])]
    );
    const key = rowCount ? 'inserted/updated' : 'unchanged';
    tally[key] = (tally[key] || 0) + 1;
  }
  console.log(`Duty sections — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
}

async function migrateDutyCompletions(db) {
  const completions = db.dutyCompletions || [];
  const tally = {};
  for (const c of completions) {
    const outcome = await insertWithOrphanRetry(
      `INSERT INTO duty_completions (date, task_id, completed_by_user_id, completed_by_name, completed_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (date, task_id) DO NOTHING`,
      [c.date, c.taskId, c.completedByUserId || null, c.completedByName || 'Unknown', c.completedAt || new Date().toISOString()],
      [2]
    );
    tally[outcome] = (tally[outcome] || 0) + 1;
  }
  console.log(`Duty completions — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
}

async function migrateDutyReports(db) {
  const reports = db.dutyReports || [];
  const tally = {};
  for (const r of reports) {
    const outcome = await insertWithOrphanRetry(
      `INSERT INTO duty_reports (id, date, section, section_title, complete, reason, missing_task_texts, staff_on_shift_names, trigger, submitted_by_user_id, submitted_by_name, photo_path, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (date, section) DO NOTHING`,
      [
        r.id, r.date, r.section, r.sectionTitle || r.section, !!r.complete, r.reason || '',
        JSON.stringify(r.missingTaskTexts || []), JSON.stringify(r.staffOnShiftNames || []),
        r.trigger || 'auto', r.submittedByUserId || null, r.submittedByName || '', r.photoPath || '',
        r.createdAt || new Date().toISOString()
      ],
      [9]
    );
    tally[outcome] = (tally[outcome] || 0) + 1;
  }
  console.log(`Duty reports — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
  if (reports.length) await query(`SELECT setval(pg_get_serial_sequence('duty_reports', 'id'), COALESCE((SELECT MAX(id) FROM duty_reports), 1))`);
}

async function migrateTrainingItems(db) {
  const items = db.trainingItems || [];
  const tally = {};
  for (const t of items) {
    const outcome = await insertWithOrphanRetry(
      `INSERT INTO training_items (id, category, name, subtitle, ingredients, method, serving_notes, photo_path, video_path, youtube_url, youtube_id, created_by_user_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
      [
        t.id, t.category, t.name, t.subtitle || '', t.ingredients || '', t.method || '', t.servingNotes || '',
        t.photoPath || '', t.videoPath || '', t.youtubeUrl || '', t.youtubeId || '', t.createdByUserId || null,
        t.createdAt || new Date().toISOString(), t.updatedAt || t.createdAt || new Date().toISOString()
      ],
      [11]
    );
    tally[outcome] = (tally[outcome] || 0) + 1;
  }
  console.log(`Training items — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
  if (items.length) await query(`SELECT setval(pg_get_serial_sequence('training_items', 'id'), COALESCE((SELECT MAX(id) FROM training_items), 1))`);
}

// Settings is a singleton JSONB blob — merge the live JSON values
// (slotDurationMinutes, reminderHoursBefore, openHour, closeHour,
// cashSafeLodgementTarget, and anything else present) straight in, the
// same shape settings.js's saveSettings() already expects.
async function migrateSettings(db) {
  const settings = db.settings || {};
  if (!Object.keys(settings).length) {
    console.log('Settings — none found in JSON, leaving SQL defaults in place.');
    return;
  }
  await query(
    `INSERT INTO settings (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [JSON.stringify(settings)]
  );
  console.log(`Settings — migrated (${Object.keys(settings).join(', ')}).`);
}

async function migrateMenu(db) {
  const menu = db.menu || { intro: '', sections: [] };
  await query(
    `INSERT INTO menu (id, intro, sections) VALUES (1, $1, $2) ON CONFLICT (id) DO UPDATE SET intro = EXCLUDED.intro, sections = EXCLUDED.sections`,
    [menu.intro || '', JSON.stringify(menu.sections || [])]
  );
  console.log(`Menu — migrated (intro: ${menu.intro ? 'yes' : 'empty'}, ${(menu.sections || []).length} sections).`);
}

async function migrateEvents(db) {
  const events = db.events || [];
  const tally = {};
  for (const e of events) {
    const { rowCount } = await query(
      `INSERT INTO events (id, title, date, description, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [e.id, e.title, e.date || null, e.description || '', e.createdAt || new Date().toISOString()]
    );
    const key = rowCount ? 'inserted' : 'already-present';
    tally[key] = (tally[key] || 0) + 1;
  }
  console.log(`Events — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
  if (events.length) await query(`SELECT setval(pg_get_serial_sequence('events', 'id'), COALESCE((SELECT MAX(id) FROM events), 1))`);
}

async function main() {
  const db = readDb();
  const counts = {
    notifications: (db.notifications || []).length,
    dutySections: (db.dutySections || []).length,
    dutyCompletions: (db.dutyCompletions || []).length,
    dutyReports: (db.dutyReports || []).length,
    trainingItems: (db.trainingItems || []).length,
    events: (db.events || []).length,
    settings: db.settings ? Object.keys(db.settings).length : 0,
    menu: db.menu ? 1 : 0
  };
  console.log('Found in data/db.json:', counts);

  await migrateNotifications(db);
  await migrateDutySections(db);
  await migrateDutyCompletions(db);
  await migrateDutyReports(db);
  await migrateTrainingItems(db);
  await migrateSettings(db);
  await migrateMenu(db);
  await migrateEvents(db);

  console.log('\nDone. Check the Notifications, Duties, Training & Resources, Settings, and Menu & Events pages show this data correctly.');
  await getPool().end();
}

main().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
