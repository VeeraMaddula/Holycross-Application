// Staff clock in/out (the kiosk tablet's core job) and the 4-digit kiosk
// PIN that gates it — a separate, shorter credential from the login
// password, punched in on the shared tablet rather than typed on a keyboard.
const { readDb, writeDb } = require('../db');
const { hashPassword, verifyPassword } = require('../password');
const { listUsers, getUserById, setUserPinHash, setLiveShiftAvatar } = require('./users');
const { toDateStr } = require('../dateUtils');

// NOTE ON MIXED SYNC/ASYNC: users now live in CockroachDB (async), but
// clock entries (timeEntries) are still in data/db.json (sync) until this
// file's own turn in the migration (task #207). Functions that only touch
// timeEntries stay sync; anything that touches a user (PIN, live shift
// avatar, staff roster) is now async because users.js is. Every caller of
// an async function below has been updated to await it — see routes/kiosk.js,
// routes/profile.js, routes/timesheets.js, routes/dashboard.js,
// routes/staffStatus.js, routes/myShifts.js.

// Status is derived from each user's most recent time entry rather than
// stored separately, so there's a single source of truth:
//   no entries, or latest action is clock_out -> "clocked_out"
//   latest action is break_start              -> "on_break"
//   latest action is clock_in or break_end     -> "clocked_in"
function getLatestClockEntry(userId) {
  const db = readDb();
  const entries = (db.timeEntries || []).filter(e => e.userId === Number(userId));
  if (!entries.length) return null;
  return entries.reduce((latest, e) => (new Date(e.at) > new Date(latest.at) ? e : latest));
}

function getStaffStatus(userId) {
  const latest = getLatestClockEntry(userId);
  if (!latest || latest.action === 'clock_out') {
    return { status: 'clocked_out', since: latest ? latest.at : null };
  }
  if (latest.action === 'break_start') {
    return { status: 'on_break', since: latest.at };
  }
  return { status: 'clocked_in', since: latest.at }; // clock_in or break_end
}

// The clock_in time that started the shift currently in progress (walks
// back through entries, newest first, until it hits the clock_in — or a
// clock_out, meaning there's no active shift). Distinct from getStaffStatus's
// `since`, which for "on_break" is the break's own start time, not the
// original clock-in — the dashboard needs both.
function getCurrentShiftStart(userId) {
  const entries = listClockEntries({ userId }); // newest first
  for (const e of entries) {
    if (e.action === 'clock_in') return e.at;
    if (e.action === 'clock_out') return null;
  }
  return null;
}

// Which single action is legal next, given a current status. Enforced
// server-side so a stale/tampered client request can't log an impossible
// sequence (e.g. clocking in twice in a row).
function nextValidAction(status) {
  if (status === 'clocked_out') return 'clock_in';
  if (status === 'clocked_in') return ['clock_out', 'break_start'];
  if (status === 'on_break') return 'break_end';
  return null;
}

async function listAllStaffStatus() {
  const users = (await listUsers()).filter(u => u.active);
  return users.map(u => {
    const status = getStaffStatus(u.id);
    const clockInAt = (status.status === 'clocked_in' || status.status === 'on_break')
      ? getCurrentShiftStart(u.id)
      : null;
    return {
      user: { id: u.id, name: u.name, role: u.role, avatarPath: u.liveShiftAvatarPath || u.avatarPath || '' },
      ...status,
      clockInAt
    };
  });
}

function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

async function setUserPin(id, pin) {
  if (!isValidPin(pin)) return { error: 'PIN must be exactly 4 digits.' };
  const u = await getUserById(id);
  if (!u) return { error: 'User not found.' };
  await setUserPinHash(u.id, hashPassword(pin));
  return { ok: true };
}

async function verifyUserPin(id, pin) {
  if (!isValidPin(pin)) return false;
  const u = await getUserById(id);
  if (!u || !u.pinHash) return false;
  return verifyPassword(pin, u.pinHash);
}

// The "live" photo taken at clock-in / break-start / break-end — shown in
// place of the person's saved profile picture for the rest of their shift,
// separate from (and never overwriting) their actual avatarPath. Cleared
// back to '' on clock-out so their saved picture reappears everywhere.
async function setUserLiveShiftAvatar(id, avatarPath) {
  const u = await getUserById(id);
  if (!u) return { error: 'User not found.' };
  await setLiveShiftAvatar(u.id, avatarPath || '');
  return { ok: true };
}

// Everyone who can appear as a tile on the kiosk screen — every active user
// except the kiosk/Bot account itself (it shouldn't be able to clock itself
// in). Includes live status + since (for the running clocked-in/break timer
// on each tile) and the effective avatar (live shift photo if there is one,
// otherwise their saved profile picture).
async function getKioskRoster() {
  const users = (await listUsers()).filter(u => u.active && u.role !== 'kiosk');
  return users.map(u => {
    const status = getStaffStatus(u.id);
    return {
      id: u.id,
      name: u.name,
      avatarPath: u.liveShiftAvatarPath || u.avatarPath || '',
      baseAvatarPath: u.avatarPath || '',
      color: u.color || '#7a8f6b',
      hasPin: !!u.pinHash,
      status: status.status,
      since: status.since
    };
  });
}

function addClockEntry({ userId, userName, action, selfiePath }) {
  const db = readDb();
  if (!db.timeEntries) db.timeEntries = [];
  if (!db.meta.nextTimeEntryId) db.meta.nextTimeEntryId = 1;
  const entry = {
    id: db.meta.nextTimeEntryId++,
    userId: Number(userId),
    userName,
    action,
    at: new Date().toISOString(),
    selfiePath: selfiePath || ''
  };
  db.timeEntries.push(entry);
  writeDb(db);
  return entry;
}

function listClockEntries({ userId, from, to } = {}) {
  const db = readDb();
  let entries = db.timeEntries || [];
  if (userId) entries = entries.filter(e => e.userId === Number(userId));
  if (from) entries = entries.filter(e => e.at >= from);
  if (to) entries = entries.filter(e => e.at <= to);
  return entries.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
}

function getClockEntry(id) {
  const db = readDb();
  return (db.timeEntries || []).find(e => e.id === Number(id));
}

const CLOCK_ACTIONS = ['clock_in', 'clock_out', 'break_start', 'break_end'];

// Manager-entered correction for a shift the kiosk never saw — staff forgot
// to tap in or out. No selfie (that only happens at the kiosk); flagged as
// manuallyAdded plus who added it, so it's clear in the log this didn't
// come from the tablet.
async function addManualClockEntry({ userId, action, at, addedBy }) {
  const user = await getUserById(userId);
  if (!user) return { error: 'Staff member not found.' };
  const db = readDb();
  if (!CLOCK_ACTIONS.includes(action)) return { error: 'Please choose a valid action.' };
  const atDate = at ? new Date(at) : new Date();
  if (isNaN(atDate.getTime())) return { error: 'Please enter a valid date and time.' };
  if (!db.timeEntries) db.timeEntries = [];
  if (!db.meta.nextTimeEntryId) db.meta.nextTimeEntryId = 1;
  const entry = {
    id: db.meta.nextTimeEntryId++,
    userId: user.id,
    userName: user.name,
    action,
    at: atDate.toISOString(),
    selfiePath: '',
    manuallyAdded: true,
    editedBy: addedBy || ''
  };
  db.timeEntries.push(entry);
  writeDb(db);
  return { entry };
}

// Corrects an existing entry's action and/or time (e.g. the kiosk logged
// "clock in" at the wrong time, or someone tapped the wrong tile). Tracks
// who made the correction and when, without touching the original selfie.
function updateClockEntry(id, { action, at, editedBy }) {
  const db = readDb();
  const entry = (db.timeEntries || []).find(e => e.id === Number(id));
  if (!entry) return { error: 'Entry not found.' };
  if (action) {
    if (!CLOCK_ACTIONS.includes(action)) return { error: 'Please choose a valid action.' };
    entry.action = action;
  }
  if (at) {
    const atDate = new Date(at);
    if (isNaN(atDate.getTime())) return { error: 'Please enter a valid date and time.' };
    entry.at = atDate.toISOString();
  }
  entry.edited = true;
  entry.editedBy = editedBy || entry.editedBy || '';
  entry.editedAt = new Date().toISOString();
  writeDb(db);
  return { entry };
}

// Removes a mistaken entry entirely (accidental double-tap on the kiosk, etc).
function deleteClockEntry(id) {
  const db = readDb();
  const idx = (db.timeEntries || []).findIndex(e => e.id === Number(id));
  if (idx === -1) return { error: 'Entry not found.' };
  db.timeEntries.splice(idx, 1);
  writeDb(db);
  return { ok: true };
}

// Per-day worked minutes for one user across a Mon-Sun (or any) date range —
// pairs each clock_in with its following clock_out (walking oldest-first,
// same convention as timesheets.js's buildShiftTotalsByEntryId), subtracts
// any break taken during that shift, and attributes the whole span to the
// calendar day the clock_in happened on (a shift belongs to the day it
// started, even if it runs past midnight). A shift still in progress right
// now (clocked in or on break) counts up to this moment, so "today" doesn't
// show as Off mid-shift. Powers the "this week" mini calendar on the
// profile page — a day with 0 minutes is simply rendered as "Off" there.
function getWeeklyHoursForUser(userId, fromDateStr, toDateStrParam) {
  const chronological = listClockEntries({ userId }).slice().reverse(); // oldest first
  const byDay = {};
  let workStart = null;
  let workStartDay = null;
  let breakStart = null;
  let breakMs = 0;

  function addToDay(day, minutes) {
    if (!day) return;
    byDay[day] = (byDay[day] || 0) + Math.max(0, minutes);
  }

  for (const e of chronological) {
    const t = new Date(e.at).getTime();
    if (e.action === 'clock_in') {
      workStart = t;
      workStartDay = toDateStr(new Date(e.at));
      breakStart = null;
      breakMs = 0;
    } else if (e.action === 'break_start') {
      breakStart = t;
    } else if (e.action === 'break_end') {
      if (breakStart) { breakMs += t - breakStart; breakStart = null; }
    } else if (e.action === 'clock_out') {
      if (workStart) {
        addToDay(workStartDay, Math.round((t - workStart) / 60000) - Math.round(breakMs / 60000));
      }
      workStart = null;
      workStartDay = null;
      breakMs = 0;
    }
  }
  // Still clocked in / on break right now — count up to this moment.
  if (workStart) {
    addToDay(workStartDay, Math.round((Date.now() - workStart) / 60000) - Math.round(breakMs / 60000));
  }

  const days = [];
  let cur = new Date(fromDateStr + 'T00:00:00');
  const end = new Date(toDateStrParam + 'T00:00:00');
  while (cur <= end) {
    const ds = toDateStr(cur);
    days.push({ date: ds, minutes: byDay[ds] || 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

module.exports = {
  getLatestClockEntry, getStaffStatus, getCurrentShiftStart, nextValidAction, listAllStaffStatus,
  isValidPin, setUserPin, verifyUserPin, setUserLiveShiftAvatar, getKioskRoster,
  addClockEntry, listClockEntries, getClockEntry, addManualClockEntry, updateClockEntry, deleteClockEntry,
  getWeeklyHoursForUser
};
