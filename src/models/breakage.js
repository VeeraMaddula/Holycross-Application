// Breakage / stock-shortage reports: prompted every time any staff member
// clocks OUT at the kiosk (see routes/kiosk.js). SQL-backed from the start
// (see db/schema.sql / db/005_add_vouchers_and_breakage.sql) — every
// function here is ASYNC, every caller must await it.
const { query } = require('../sqlPool');

const BREAKAGE_CATEGORIES = [
  { value: 'glass', label: 'Glass' },
  { value: 'spirit', label: 'Spirit' },
  { value: 'soft_drink', label: 'Soft Drink' }
];
const BREAKAGE_CATEGORY_VALUES = BREAKAGE_CATEGORIES.map(c => c.value);
const BREAKAGE_CATEGORY_LABELS = Object.fromEntries(BREAKAGE_CATEGORIES.map(c => [c.value, c.label]));

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    category: r.category,
    note: r.note || '',
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null
  };
}

async function listBreakageReports() {
  const { rows } = await query(`SELECT * FROM breakage_reports ORDER BY created_at DESC`);
  return rows.map(mapRow);
}

async function listBreakageReportsByUser(userId) {
  const { rows } = await query(`SELECT * FROM breakage_reports WHERE user_id = $1 ORDER BY created_at DESC`, [Number(userId)]);
  return rows.map(mapRow);
}

async function addBreakageReport({ userId, userName, category, note }) {
  const cat = String(category || '').trim();
  if (!BREAKAGE_CATEGORY_VALUES.includes(cat)) return { error: 'Pick a valid breakage category.' };
  const { rows } = await query(
    `INSERT INTO breakage_reports (user_id, user_name, category, note) VALUES ($1,$2,$3,$4) RETURNING id`,
    [userId || null, userName || 'Unknown', cat, (note || '').trim()]
  );
  return { report: mapRow((await query(`SELECT * FROM breakage_reports WHERE id = $1`, [rows[0].id])).rows[0]) };
}

// Who's breaking/losing more stock over time — grouped by staff member, for
// the senior/general manager + accountant report view.
async function getBreakageCountsByUser() {
  const { rows } = await query(
    `SELECT user_id, user_name, category, count(*)::int AS n
     FROM breakage_reports
     GROUP BY user_id, user_name, category
     ORDER BY user_name ASC`
  );
  const byUser = new Map();
  for (const r of rows) {
    const key = r.user_id || r.user_name;
    if (!byUser.has(key)) {
      byUser.set(key, { userId: r.user_id, userName: r.user_name, total: 0, byCategory: {} });
    }
    const entry = byUser.get(key);
    entry.byCategory[r.category] = r.n;
    entry.total += r.n;
  }
  return Array.from(byUser.values()).sort((a, b) => b.total - a.total);
}

module.exports = {
  BREAKAGE_CATEGORIES, BREAKAGE_CATEGORY_VALUES, BREAKAGE_CATEGORY_LABELS,
  listBreakageReports, listBreakageReportsByUser, addBreakageReport, getBreakageCountsByUser
};
