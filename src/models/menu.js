// Menu & Events: the public-facing food/drinks menu content and the
// events list shown on the Menu & Events page. SQL-backed as of task #209
// — the existing `menu`/`events` tables' shapes already matched, so only
// this model file needed rewriting. Every exported function is now ASYNC.
const { query } = require('../sqlPool');

const DEFAULT_MENU = { intro: '', sections: [] };

async function getMenu() {
  const { rows } = await query(`SELECT intro, sections FROM menu WHERE id = 1`);
  if (!rows.length) return DEFAULT_MENU;
  return { intro: rows[0].intro || '', sections: rows[0].sections || [] };
}

async function saveMenu(menu) {
  await query(
    `INSERT INTO menu (id, intro, sections) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET intro = EXCLUDED.intro, sections = EXCLUDED.sections`,
    [menu.intro || '', JSON.stringify(menu.sections || [])]
  );
}

// to_char(...) keeps `date` a plain 'YYYY-MM-DD' string, same reasoning as
// bookings/roster_shifts elsewhere in this migration — avoids `pg` handing
// back a JS Date object (and the timezone-shift bugs that come with it).
const EVENT_COLUMNS = `id, title, to_char(date, 'YYYY-MM-DD') AS date, description`;

async function listEvents() {
  const { rows } = await query(`SELECT ${EVENT_COLUMNS} FROM events ORDER BY date ASC`);
  return rows;
}

async function createEvent({ title, date, description }) {
  const { rows } = await query(
    `INSERT INTO events (title, date, description) VALUES ($1, $2, $3) RETURNING ${EVENT_COLUMNS}`,
    [title, date, description || '']
  );
  return rows[0];
}

async function deleteEvent(id) {
  await query(`DELETE FROM events WHERE id = $1`, [Number(id)]);
}

module.exports = { getMenu, saveMenu, listEvents, createEvent, deleteEvent };
