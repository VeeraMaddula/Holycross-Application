// Roster: direct per-date shifts, no recurring pattern. Design: every shift
// is pinned to one specific calendar date — there is no "repeats every
// week" layer. That's deliberate: a small bar/restaurant's staffing changes
// week to week (holidays, swaps, seasonal hours), so a recurring template
// just meant editing overrides on top of a template every week anyway.
// Assigning directly to a date is simpler and always shows exactly who's
// actually working.
const { readDb, writeDb } = require('../db');
const { toDateStr } = require('../dateUtils');
const { defaultColorForId } = require('./shared');
const { getUserById, listUsers } = require('./users');
// NOTE: rosterShifts themselves are still JSON (this file's own turn in the
// migration hasn't happened yet — task #207); only the user lookups here
// are now async SQL, same mixed-async pattern as clockEntries.js.

// Which part of the venue a shift covers. Optional — older shifts saved
// before this field existed simply have area === undefined, which the UI
// treats as "unspecified" rather than an error. To schedule someone on both
// bar and floor in one day, add two separate shift entries (one per area)
// rather than trying to encode a split inside a single shift.
const AREAS = ['floor', 'bar', 'booth'];
const AREA_LABELS = { floor: 'Floor', bar: 'Bar', booth: 'Booth' };

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

// Shifts within a date range, joined with staff name/colour for the roster grid.
async function listRosterShiftsForRange(fromDate, toDate) {
  const db = readDb();
  const users = await listUsers();
  const shifts = (db.rosterShifts || []).filter(s => s.date >= fromDate && s.date <= toDate);
  return shifts.map(s => {
    // String-compare, not ===: users.id comes back from CockroachDB (via
    // `pg`) as a string for its INT8-backed SERIAL column, while s.userId
    // here is a plain JS Number (see addRosterShift's Number(userId)) — a
    // strict === between them is always false, which is exactly what was
    // making every shift show up as "Unknown staff" regardless of which
    // staff member was actually picked. Same fix already used in
    // timesheets.ejs's filter dropdown for the same underlying mismatch.
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
async function addRosterShift({ date, userId, startTime, endTime, area }) {
  const db = readDb();
  if (!db.rosterShifts) db.rosterShifts = [];
  if (!db.meta.nextRosterShiftId) db.meta.nextRosterShiftId = 1;
  const shift = {
    id: db.meta.nextRosterShiftId++,
    date,
    userId: Number(userId),
    startTime, endTime,
    area: AREAS.includes(area) ? area : null,
    notified: false,
    pendingAction: 'assigned'
  };
  db.rosterShifts.push(shift);
  writeDb(db);
  const user = await getUserById(shift.userId);
  return { shift: { ...shift, user: user || null } };
}

async function updateRosterShift(id, { date, startTime, endTime, area }) {
  const db = readDb();
  const shift = (db.rosterShifts || []).find(s => s.id === Number(id));
  if (!shift) return { error: 'Shift not found.' };
  if (date) shift.date = date;
  if (startTime) shift.startTime = startTime;
  if (endTime) shift.endTime = endTime;
  if (area !== undefined) shift.area = AREAS.includes(area) ? area : null;
  shift.notified = false;
  shift.pendingAction = 'updated';
  writeDb(db);
  const user = await getUserById(shift.userId);
  return { shift: { ...shift, user: user || null } };
}

// Shifts on a given date that haven't been notified yet, joined with the
// full user record (notifyShift needs .email/.phone/.name, not just the
// name/colour that listRosterShiftsForRange's join provides).
async function getPendingNotificationsForDate(date) {
  const db = readDb();
  const pending = (db.rosterShifts || []).filter(s => s.date === date && !s.notified);
  const result = [];
  for (const s of pending) {
    const user = await getUserById(s.userId);
    result.push({ ...s, user: user || null });
  }
  return result;
}

function markShiftsNotifiedForDate(date) {
  const db = readDb();
  (db.rosterShifts || []).forEach(s => { if (s.date === date) s.notified = true; });
  writeDb(db);
}

function removeRosterShift(id) {
  const db = readDb();
  db.rosterShifts = (db.rosterShifts || []).filter(s => s.id !== Number(id));
  writeDb(db);
}

// Removes any shift whose userId no longer matches a real user — these
// show up as "Unknown staff" in the UI. In practice this happens when the
// JSON roster file (still not migrated to the SQL database — task #207)
// has entries left over from before the users table moved to CockroachDB,
// where the old JSON-era user ids don't line up with the new ones. Returns
// how many were removed so the caller can report it back.
//
// validIds must hold strings, not the raw values from listUsers() — a
// user's id comes back from CockroachDB as a string (INT8-backed SERIAL
// column), and Set.has() uses strict equality, so comparing it against
// s.userId (a plain JS Number) would never match and this would wrongly
// treat every real shift as orphaned.
async function removeOrphanedShifts() {
  const db = readDb();
  const users = await listUsers();
  const validIds = new Set(users.map(u => String(u.id)));
  const shifts = db.rosterShifts || [];
  const before = shifts.length;
  db.rosterShifts = shifts.filter(s => validIds.has(String(s.userId)));
  const removed = before - db.rosterShifts.length;
  if (removed > 0) writeDb(db);
  return removed;
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
  const uid = Number(userId);
  return schedule
    .map(day => ({ date: day.date, dayOfWeek: day.dayOfWeek, shifts: day.shifts.filter(s => s.userId === uid) }))
    .filter(day => day.shifts.length > 0);
}

module.exports = {
  AREAS, AREA_LABELS,
  listRosterShiftsForRange, addRosterShift, updateRosterShift, removeRosterShift,
  getResolvedScheduleForRange, getUserUpcomingShifts,
  getPendingNotificationsForDate, markShiftsNotifiedForDate,
  removeOrphanedShifts
};
