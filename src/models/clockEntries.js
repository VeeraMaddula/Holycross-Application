// Staff clock in/out (the kiosk tablet's core job) and the 4-digit kiosk
// PIN that gates it — a separate, shorter credential from the login
// password, punched in on the shared tablet rather than typed on a keyboard.
//
// SQL-backed as of task #207 (time_entries table — see db/schema.sql and
// db/009_redesign_time_entries.sql). One row per clock action (clock_in,
// clock_out, break_start, break_end), matching exactly how the kiosk always
// recorded entries — shift/break durations are still computed here in
// application code by pairing consecutive rows, never stored as a span.
// Every exported function that touches the database is now ASYNC; every
// caller has been updated to await it.
const { query } = require('../sqlPool');
const { hashPassword, verifyPassword } = require('../password');
const { listUsers, getUserById, setUserPinHash, setLiveShiftAvatar } = require('./users');
const { toDateStr } = require('../dateUtils');

function mapEntryRow(r) {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    action: r.action,
    at: new Date(r.at).toISOString(),
    selfiePath: r.selfie_path || '',
    manuallyAdded: r.manually_added,
    edited: r.edited,
    editedBy: r.edited_by || '',
    editedAt: r.edited_at ? new Date(r.edited_at).toISOString() : null
  };
}

// Status is derived from each user's most recent time entry rather than
// stored separately, so there's a single source of truth:
//   no entries, or latest action is clock_out -> "clocked_out"
//   latest action is break_start              -> "on_break"
//   latest action is clock_in or break_end     -> "clocked_in"
async function getLatestClockEntry(userId) {
  const { rows } = await query(
    `SELECT * FROM time_entries WHERE user_id = $1 ORDER BY at DESC LIMIT 1`,
    [Number(userId)]
  );
  return rows[0] ? mapEntryRow(rows[0]) : null;
}

async function getStaffStatus(userId) {
  const latest = await getLatestClockEntry(userId);
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
async function getCurrentShiftStart(userId) {
  const entries = await listClockEntries({ userId }); // newest first
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
  const result = [];
  for (const u of users) {
    const status = await getStaffStatus(u.id);
    const clockInAt = (status.status === 'clocked_in' || status.status === 'on_break')
      ? await getCurrentShiftStart(u.id)
      : null;
    result.push({
      user: { id: u.id, name: u.name, role: u.role, avatarPath: u.liveShiftAvatarPath || u.avatarPath || '' },
      ...status,
      clockInAt
    });
  }
  return result;
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
  const result = [];
  for (const u of users) {
    const status = await getStaffStatus(u.id);
    result.push({
      id: u.id,
      name: u.name,
      avatarPath: u.liveShiftAvatarPath || u.avatarPath || '',
      baseAvatarPath: u.avatarPath || '',
      color: u.color || '#7a8f6b',
      hasPin: !!u.pinHash,
      status: status.status,
      since: status.since
    });
  }
  return result;
}

async function addClockEntry({ userId, userName, action, selfiePath }) {
  const { rows } = await query(
    `INSERT INTO time_entries (user_id, user_name, action, at, selfie_path)
     VALUES ($1, $2, $3, now(), $4)
     RETURNING *`,
    [Number(userId), userName, action, selfiePath || '']
  );
  return mapEntryRow(rows[0]);
}

async function listClockEntries({ userId, from, to } = {}) {
  const conditions = [];
  const params = [];
  if (userId) { params.push(Number(userId)); conditions.push(`user_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`at <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM time_entries ${where} ORDER BY at DESC`, params);
  return rows.map(mapEntryRow);
}

async function getClockEntry(id) {
  const { rows } = await query(`SELECT * FROM time_entries WHERE id = $1`, [Number(id)]);
  return rows[0] ? mapEntryRow(rows[0]) : null;
}

const CLOCK_ACTIONS = ['clock_in', 'clock_out', 'break_start', 'break_end'];

// Manager-entered correction for a shift the kiosk never saw — staff forgot
// to tap in or out. No selfie (that only happens at the kiosk); flagged as
// manuallyAdded plus who added it, so it's clear in the log this didn't
// come from the tablet.
async function addManualClockEntry({ userId, action, at, addedBy }) {
  const user = await getUserById(userId);
  if (!user) return { error: 'Staff member not found.' };
  if (!CLOCK_ACTIONS.includes(action)) return { error: 'Please choose a valid action.' };
  const atDate = at ? new Date(at) : new Date();
  if (isNaN(atDate.getTime())) return { error: 'Please enter a valid date and time.' };
  const { rows } = await query(
    `INSERT INTO time_entries (user_id, user_name, action, at, selfie_path, manually_added, edited_by)
     VALUES ($1, $2, $3, $4, '', true, $5)
     RETURNING *`,
    [Number(user.id), user.name, action, atDate.toISOString(), addedBy || '']
  );
  return { entry: mapEntryRow(rows[0]) };
}

// Corrects an existing entry's action and/or time (e.g. the kiosk logged
// "clock in" at the wrong time, or someone tapped the wrong tile). Tracks
// who made the correction and when, without touching the original selfie.
async function updateClockEntry(id, { action, at, editedBy }) {
  const existing = await getClockEntry(id);
  if (!existing) return { error: 'Entry not found.' };
  let newAction = existing.action;
  if (action) {
    if (!CLOCK_ACTIONS.includes(action)) return { error: 'Please choose a valid action.' };
    newAction = action;
  }
  let newAt = existing.at;
  if (at) {
    const atDate = new Date(at);
    if (isNaN(atDate.getTime())) return { error: 'Please enter a valid date and time.' };
    newAt = atDate.toISOString();
  }
  const { rows } = await query(
    `UPDATE time_entries SET action = $1, at = $2, edited = true, edited_by = $3, edited_at = now()
     WHERE id = $4
     RETURNING *`,
    [newAction, newAt, editedBy || existing.editedBy || '', Number(id)]
  );
  return { entry: mapEntryRow(rows[0]) };
}

// Removes a mistaken entry entirely (accidental double-tap on the kiosk, etc).
async function deleteClockEntry(id) {
  const { rowCount } = await query(`DELETE FROM time_entries WHERE id = $1`, [Number(id)]);
  if (!rowCount) return { error: 'Entry not found.' };
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
async function getWeeklyHoursForUser(userId, fromDateStr, toDateStrParam) {
  const chronological = (await listClockEntries({ userId })).slice().reverse(); // oldest first
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
