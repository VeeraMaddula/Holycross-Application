// Staff clock in/out (the kiosk tablet's core job) and the 4-digit kiosk
// PIN that gates it — a separate, shorter credential from the login
// password, punched in on the shared tablet rather than typed on a keyboard.
const { readDb, writeDb } = require('../db');
const { hashPassword, verifyPassword } = require('../password');
const { listUsers, getUserById } = require('./users');

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

function listAllStaffStatus() {
  return listUsers().filter(u => u.active).map(u => {
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

function setUserPin(id, pin) {
  if (!isValidPin(pin)) return { error: 'PIN must be exactly 4 digits.' };
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.pinHash = hashPassword(pin);
  writeDb(db);
  return { ok: true };
}

function verifyUserPin(id, pin) {
  if (!isValidPin(pin)) return false;
  const u = getUserById(id);
  if (!u || !u.pinHash) return false;
  return verifyPassword(pin, u.pinHash);
}

// The "live" photo taken at clock-in / break-start / break-end — shown in
// place of the person's saved profile picture for the rest of their shift,
// separate from (and never overwriting) their actual avatarPath. Cleared
// back to '' on clock-out so their saved picture reappears everywhere.
function setUserLiveShiftAvatar(id, avatarPath) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.liveShiftAvatarPath = avatarPath || '';
  writeDb(db);
  return { ok: true };
}

// Everyone who can appear as a tile on the kiosk screen — every active user
// except the kiosk/Bot account itself (it shouldn't be able to clock itself
// in). Includes live status + since (for the running clocked-in/break timer
// on each tile) and the effective avatar (live shift photo if there is one,
// otherwise their saved profile picture).
function getKioskRoster() {
  return listUsers().filter(u => u.active && u.role !== 'kiosk').map(u => {
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
function addManualClockEntry({ userId, action, at, addedBy }) {
  const db = readDb();
  const user = (db.users || []).find(u => u.id === Number(userId));
  if (!user) return { error: 'Staff member not found.' };
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

module.exports = {
  getLatestClockEntry, getStaffStatus, getCurrentShiftStart, nextValidAction, listAllStaffStatus,
  isValidPin, setUserPin, verifyUserPin, setUserLiveShiftAvatar, getKioskRoster,
  addClockEntry, listClockEntries, getClockEntry, addManualClockEntry, updateClockEntry, deleteClockEntry
};
