// Roster: direct per-date shifts, no recurring pattern. Design: every shift
// is pinned to one specific calendar date — there is no "repeats every
// week" layer. That's deliberate: a small bar/restaurant's staffing changes
// week to week (holidays, swaps, seasonal hours), so a recurring template
// just meant editing overrides on top of a template every week anyway.
// Assigning directly to a date is simpler and always shows exactly who's
// actually working.
//
// SQL-backed as of task #207 (roster_shifts table — see db/schema.sql and
// db/008_add_roster_shift_fields.sql). Every exported function is now
// ASYNC; every caller must await it (most already did, since this file
// already touched users.js, which went SQL earlier).
const { query } = require('../sqlPool');
const { toDateStr } = require('../dateUtils');
const { defaultColorForId } = require('./shared');
const { getUserById, listUsers } = require('./users');

// Which part of the venue a shift covers. Optional — older shifts saved
// before this field existed simply have area === null, which the UI
// treats as "unspecified" rather than an error. To schedule someone on both
// bar and floor in one day, add two separate shift entries (one per area)
// rather than trying to encode a split inside a single shift.
const AREAS = ['floor', 'bar', 'booth'];
const AREA_LABELS = { floor: 'Floor', bar: 'Bar', booth: 'Booth' };

const SHIFT_COLUMNS = `id, to_char(date, 'YYYY-MM-DD') AS date, user_id, start_time, end_time, area, notified, pending_action`;

// date comes back pre-formatted as 'YYYY-MM-DD' via to_char above, so the
// rest of this file's plain string comparisons (s.date >= fromDate) and
// .localeCompare-style sorting keep working exactly as they did against
// the old JSON rows — no Date-object/timezone handling needed here.
function mapShiftRow(r) {
  return {
    id: r.id,
    date: r.date,
    userId: r.user_id,
    startTime: r.start_time,
    endTime: r.end_time,
    area: r.area || null,
    notified: r.notified,
    pendingAction: r.pending_action || null
  };
}

function dateToDayOfWeek(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay(); // 0=Sun..6=Sat
}

function eachDateInRange(fromDate, toDate) {
  const dates = [];
  let cur = new Date(fromDate + 'T00:00:00');
  const end = new Date(toDate + 'T00:00:00');
  while (cur <= end) {
    dates.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function getRosterShiftById(id) {
  const { rows } = await query(`SELECT ${SHIFT_COLUMNS} FROM roster_shifts WHERE id = $1`, [Number(id)]);
  return rows[0] ? mapShiftRow(rows[0]) : null;
}

// Shifts within a date range, joined with staff name/colour for the roster grid.
async function listRosterShiftsForRange(fromDate, toDate) {
  const { rows } = await query(
    `SELECT ${SHIFT_COLUMNS} FROM roster_shifts WHERE date >= $1 AND date <= $2`,
    [fromDate, toDate]
  );
  const users = await listUsers();
  return rows.map(mapShiftRow).map(s => {
    // String-compare, not === : users.id and s.userId are both SQL-sourced
    // now, but id columns come back from CockroachDB (via `pg`) as strings
    // for INT8-backed SERIAL columns — keep the defensive coercion rather
    // than relying on both sides happening to already be the same type.
    const user = users.find(u => String(u.id) === String(s.userId));
    return {
      ...s,
      userName: user ? user.name : 'Unknown staff',
      color: user ? (user.color || defaultColorForId(user.id)) : '#999',
      areaLabel: AREA_LABELS[s.area] || ''
    };
  });
}

// `notified` tracks whether the assigned/updated email+SMS has actually been
// sent for a shift yet. Adding or editing a shift no longer notifies the
// staff member immediately — it just marks the shift unnotified, and a
// manager sends a batch of "Shift assigned"/"Shift updated" messages for a
// given day whenever they're ready, via the day's "Send notifications"
// button (see routes/roster.js's /notify route). `pendingAction` picks which
// email/SMS wording applies once that button is pressed.
//
// roster_shifts.user_id carries a foreign key to users(id), so a shift can
// no longer be created against a nonexistent staff member — the insert
// fails loudly (mapped to a friendly error below) instead of silently
// producing a future "Unknown staff" row.
async function addRosterShift({ date, userId, startTime, endTime, area }) {
  const finalArea = AREAS.includes(area) ? area : null;
  try {
    const { rows } = await query(
      `INSERT INTO roster_shifts (user_id, date, start_time, end_time, area, notified, pending_action)
       VALUES ($1, $2, $3, $4, $5, false, 'assigned')
       RETURNING ${SHIFT_COLUMNS}`,
      [Number(userId), date, startTime, endTime, finalArea]
    );
    const shift = mapShiftRow(rows[0]);
    const user = await getUserById(shift.userId);
    return { shift: { ...shift, user: user || null } };
  } catch (err) {
    if (err.code === '23503') return { error: 'Staff member not found.' };
    throw err;
  }
}

async function updateRosterShift(id, { date, startTime, endTime, area }) {
  const existing = await getRosterShiftById(id);
  if (!existing) return { error: 'Shift not found.' };
  const finalArea = area !== undefined ? (AREAS.includes(area) ? area : null) : existing.area;
  const { rows } = await query(
    `UPDATE roster_shifts
     SET date = $1, start_time = $2, end_time = $3, area = $4, notified = false, pending_action = 'updated'
     WHERE id = $5
     RETURNING ${SHIFT_COLUMNS}`,
    [date || existing.date, startTime || existing.startTime, endTime || existing.endTime, finalArea, Number(id)]
  );
  const shift = mapShiftRow(rows[0]);
  const user = await getUserById(shift.userId);
  return { shift: { ...shift, user: user || null } };
}

// Shifts in a date range (inclusive) that haven't been notified yet,
// joined with the full user record (notifyShift needs .email/.phone/.name,
// not just the name/colour that listRosterShiftsForRange's join provides).
// A single day's "Send notifications" button calls this with fromDate ===
// toDate; the whole week's button passes the week's start/end.
async function getPendingNotificationsForRange(fromDate, toDate) {
  const { rows } = await query(
    `SELECT ${SHIFT_COLUMNS} FROM roster_shifts WHERE date >= $1 AND date <= $2 AND notified = false`,
    [fromDate, toDate]
  );
  const result = [];
  for (const r of rows) {
    const s = mapShiftRow(r);
    const user = await getUserById(s.userId);
    result.push({ ...s, user: user || null });
  }
  return result;
}

async function markShiftsNotifiedForRange(fromDate, toDate) {
  await query(`UPDATE roster_shifts SET notified = true WHERE date >= $1 AND date <= $2`, [fromDate, toDate]);
}

async function removeRosterShift(id) {
  await query(`DELETE FROM roster_shifts WHERE id = $1`, [Number(id)]);
}

// Changes who a shift belongs to without touching anything else (date,
// times, area, notified/pendingAction) — used by shiftDrops.js (Shift
// Marketplace: pick-up / exchange hand the shift to a different staff
// member, but that's still JSON-backed for its own drop-listing bookkeeping
// — task #208 — and now reaches in here rather than into data/db.json
// directly, since roster_shifts moved to SQL in task #207).
async function setRosterShiftOwner(id, userId) {
  const { rows } = await query(
    `UPDATE roster_shifts SET user_id = $1 WHERE id = $2 RETURNING ${SHIFT_COLUMNS}`,
    [Number(userId), Number(id)]
  );
  return rows[0] ? mapShiftRow(rows[0]) : null;
}

// With roster_shifts.user_id now enforced by a foreign key (see above),
// a shift can never reference a nonexistent user — "orphaned" shifts
// structurally cannot exist once this table is SQL-backed. Kept as a
// no-op, rather than removing the route/button outright, so
// routes/roster.js's existing call site and the roster-week.ejs banner
// don't need to change; it will now always report zero removed.
async function removeOrphanedShifts() {
  return 0;
}

// Groups shifts by date for a range. Returns [{ date, dayOfWeek, shifts: [...] }, ...].
async function getResolvedScheduleForRange(fromDate, toDate) {
  const shifts = await listRosterShiftsForRange(fromDate, toDate);
  return eachDateInRange(fromDate, toDate).map(date => {
    const dayShifts = shifts
      .filter(s => s.date === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.userName.localeCompare(b.userName));
    return { date, dayOfWeek: dateToDayOfWeek(date), shifts: dayShifts };
  });
}

async function getUserUpcomingShifts(userId, fromDate, toDate) {
  const schedule = await getResolvedScheduleForRange(fromDate, toDate);
  // String-compare, not === : s.userId is SQL-sourced (string, INT8-backed)
  // while userId here is whatever the caller passed in (often a plain
  // Number) — same mismatch class as the listRosterShiftsForRange join above.
  return schedule
    .map(day => ({ date: day.date, dayOfWeek: day.dayOfWeek, shifts: day.shifts.filter(s => String(s.userId) === String(userId)) }))
    .filter(day => day.shifts.length > 0);
}

module.exports = {
  AREAS, AREA_LABELS,
  listRosterShiftsForRange, addRosterShift, updateRosterShift, removeRosterShift,
  getResolvedScheduleForRange, getUserUpcomingShifts,
  getPendingNotificationsForRange, markShiftsNotifiedForRange,
  removeOrphanedShifts, getRosterShiftById, setRosterShiftOwner
};
