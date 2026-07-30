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
function listRosterShiftsForRange(fromDate, toDate) {
  const db = readDb();
  const users = db.users || [];
  const shifts = (db.rosterShifts || []).filter(s => s.date >= fromDate && s.date <= toDate);
  return shifts.map(s => {
    const user = users.find(u => u.id === s.userId);
    return {
      ...s,
      userName: user ? user.name : 'Unknown staff',
      color: user ? (user.color || defaultColorForId(user.id)) : '#999'
    };
  });
}

function addRosterShift({ date, userId, startTime, endTime }) {
  const db = readDb();
  if (!db.rosterShifts) db.rosterShifts = [];
  if (!db.meta.nextRosterShiftId) db.meta.nextRosterShiftId = 1;
  const shift = {
    id: db.meta.nextRosterShiftId++,
    date,
    userId: Number(userId),
    startTime, endTime
  };
  db.rosterShifts.push(shift);
  writeDb(db);
  const user = (db.users || []).find(u => u.id === shift.userId);
  return { shift: { ...shift, user: user || null } };
}

function updateRosterShift(id, { date, startTime, endTime }) {
  const db = readDb();
  const shift = (db.rosterShifts || []).find(s => s.id === Number(id));
  if (!shift) return { error: 'Shift not found.' };
  if (date) shift.date = date;
  if (startTime) shift.startTime = startTime;
  if (endTime) shift.endTime = endTime;
  writeDb(db);
  const user = (db.users || []).find(u => u.id === shift.userId);
  return { shift: { ...shift, user: user || null } };
}

function removeRosterShift(id) {
  const db = readDb();
  db.rosterShifts = (db.rosterShifts || []).filter(s => s.id !== Number(id));
  writeDb(db);
}

// Groups shifts by date for a range. Returns [{ date, dayOfWeek, shifts: [...] }, ...].
function getResolvedScheduleForRange(fromDate, toDate) {
  const shifts = listRosterShiftsForRange(fromDate, toDate);
  return eachDateInRange(fromDate, toDate).map(date => {
    const dayShifts = shifts
      .filter(s => s.date === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.userName.localeCompare(b.userName));
    return { date, dayOfWeek: dateToDayOfWeek(date), shifts: dayShifts };
  });
}

function getUserUpcomingShifts(userId, fromDate, toDate) {
  const schedule = getResolvedScheduleForRange(fromDate, toDate);
  const uid = Number(userId);
  return schedule
    .map(day => ({ date: day.date, dayOfWeek: day.dayOfWeek, shifts: day.shifts.filter(s => s.userId === uid) }))
    .filter(day => day.shifts.length > 0);
}

module.exports = {
  listRosterShiftsForRange, addRosterShift, updateRosterShift, removeRosterShift,
  getResolvedScheduleForRange, getUserUpcomingShifts
};
