// App-wide settings (opening hours, slot duration, reminder timing,
// cashSafeLodgementTarget, etc.) — a single small JSONB blob, so no need
// for real columns. SQL-backed as of task #209 — the existing `settings`
// table's singleton-row shape already matched (id=1, data JSONB), so only
// this model file needed rewriting. Every exported function is now ASYNC.
const { query } = require('../sqlPool');

const DEFAULT_SETTINGS = { slotDurationMinutes: 90, reminderHoursBefore: 24, openHour: 11, closeHour: 23 };

async function ensureRow() {
  const { rows } = await query(`SELECT data FROM settings WHERE id = 1`);
  if (rows.length) return rows[0].data;
  await query(`INSERT INTO settings (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`, [JSON.stringify(DEFAULT_SETTINGS)]);
  const { rows: seeded } = await query(`SELECT data FROM settings WHERE id = 1`);
  return seeded[0].data;
}

async function getSettings() {
  return ensureRow();
}

async function saveSettings(settings) {
  const current = await ensureRow();
  const merged = { ...current, ...settings };
  await query(`UPDATE settings SET data = $1 WHERE id = 1`, [JSON.stringify(merged)]);
  return merged;
}

module.exports = { getSettings, saveSettings };
