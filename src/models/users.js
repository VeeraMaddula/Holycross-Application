// Staff/admin accounts: lookup, creation, profile edits, and the
// per-feature access-grant toggles set from the Users page. Kiosk PIN
// handling lives in clockEntries.js (it's really part of the clock-in
// flow); password-reset-by-email lives in passwordReset.js.
const { readDb, writeDb } = require('../db');
const { normalizePhone, normalizePhoneWithCountryCode } = require('../phoneUtils');
const { normalizeRole, defaultColorForId } = require('./shared');

function activeAdminCount(db) {
  return (db.users || []).filter(u => u.role === 'admin' && u.active).length;
}

function listUsers() {
  const db = readDb();
  return (db.users || []).slice().sort((a, b) => a.name.localeCompare(b.name));
}

function getUserByEmail(email) {
  const db = readDb();
  const target = String(email || '').toLowerCase();
  return (db.users || []).find(u => u.email.toLowerCase() === target);
}

// Username is a separate login identifier from the display name — e.g. a
// staff member's name might be "Venkata Satya" but their username "vsatya".
function getUserByUsername(username) {
  const db = readDb();
  const target = String(username || '').trim().toLowerCase();
  if (!target) return null;
  return (db.users || []).find(u => (u.username || '').toLowerCase() === target);
}

// Matches a phone number typed at login (with an explicit country code from
// the dropdown) against stored user.phone values, comparing both in
// normalized E.164 form so formatting differences don't matter.
function getUserByPhone(phone, countryCode) {
  const target = normalizePhoneWithCountryCode(phone, countryCode);
  if (!target) return null;
  const db = readDb();
  return (db.users || []).find(u => u.phone && normalizePhone(u.phone) === target);
}

// Login accepts username, phone number (with country code), or — for
// continuity with accounts created before usernames existed — email too.
function getUserByLoginIdentifier(identifier, countryCode) {
  if (!identifier) return null;
  return getUserByUsername(identifier) || getUserByEmail(identifier) || getUserByPhone(identifier, countryCode);
}

function getUserById(id) {
  const db = readDb();
  return (db.users || []).find(u => u.id === Number(id));
}

function createUser({ name, username, email, passwordHash, role, phone, dob, sex, location }) {
  const db = readDb();
  if (!db.users) db.users = [];
  if (!db.meta.nextUserId) db.meta.nextUserId = 1;
  const id = db.meta.nextUserId++;
  const user = {
    id,
    name,
    username: (username || '').trim(),
    email: String(email).toLowerCase(),
    passwordHash,
    role: normalizeRole(role),
    active: true,
    avatarPath: '',
    liveShiftAvatarPath: '',
    pinHash: '',
    canViewTimesheets: false,
    canManageRoster: false,
    canMakeRequests: false,
    canBookFunctions: false,
    canViewNotifications: false,
    canManageCashSafe: false,
    canViewLogs: false,
    canEditDuties: false,
    canEditTraining: false,
    privacyPolicyVersion: null,
    privacyPolicyAcceptedAt: null,
    color: defaultColorForId(id),
    phone: phone || '',
    dob: dob || '',
    sex: sex || '',
    location: location || '',
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeDb(db);
  return user;
}

// Edits the editable profile fields for an existing user (used from the
// Users > Edit page). Email and username uniqueness are re-checked since
// either can change.
function updateUserProfile(id, { name, username, email, phone, dob, sex, location }) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  if (email) {
    const target = String(email).toLowerCase();
    const clash = (db.users || []).find(x => x.id !== u.id && x.email.toLowerCase() === target);
    if (clash) return { error: 'Another user already has that email.' };
    u.email = target;
  }
  if (username) {
    const target = String(username).trim().toLowerCase();
    const clash = (db.users || []).find(x => x.id !== u.id && (x.username || '').toLowerCase() === target);
    if (clash) return { error: 'Another user already has that username.' };
    u.username = String(username).trim();
  }
  if (name) u.name = name;
  u.phone = phone || '';
  u.dob = dob || '';
  u.sex = sex || '';
  u.location = location || '';
  writeDb(db);
  return { user: u };
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function setUserColor(id, color) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  if (color && !HEX_COLOR_RE.test(String(color).trim())) {
    return { error: 'Color must be a hex value like #4287f5.' };
  }
  u.color = color || defaultColorForId(u.id);
  writeDb(db);
  return { user: u };
}

function setUserTimesheetAccess(id, allowed) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.canViewTimesheets = !!allowed;
  writeDb(db);
  return { user: u };
}

function setUserRosterAccess(id, allowed) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.canManageRoster = !!allowed;
  writeDb(db);
  return { user: u };
}

function setUserRequestsAccess(id, allowed) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.canMakeRequests = !!allowed;
  writeDb(db);
  return { user: u };
}

function setUserFunctionBookingAccess(id, allowed) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.canBookFunctions = !!allowed;
  writeDb(db);
  return { user: u };
}

function setUserNotificationsAccess(id, allowed) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.canViewNotifications = !!allowed;
  writeDb(db);
  return { user: u };
}

function acceptPrivacyPolicy(id, version) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.privacyPolicyVersion = version;
  u.privacyPolicyAcceptedAt = new Date().toISOString();
  writeDb(db);
  return { user: u };
}

function setUserCashSafeAccess(id, allowed) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.canManageCashSafe = !!allowed;
  writeDb(db);
  return { user: u };
}

// Logs page access — Admin and every manager-tier role (see MANAGER_ROLES
// in src/roles.js) already get in automatically via requireLogsAccess; this
// toggle is only for individually granting a specific Bar/Kitchen Staff
// member access, same pattern as setUserCashSafeAccess above. Off by
// default — a staff member never sees the Logs button until a manager
// switches this on for them from the Users page.
function setUserLogsAccess(id, allowed) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.canViewLogs = !!allowed;
  writeDb(db);
  return { user: u };
}

// Editing the duties TASK LIST (add/edit/remove tasks, not just ticking
// them off) — every manager-tier role gets this automatically (see
// requireDutiesEditAccess in src/middleware.js); this toggle is only for
// individually granting a specific Bar/Kitchen Staff member the same
// capability, same pattern as setUserCashSafeAccess/setUserLogsAccess above.
function setUserDutiesEditAccess(id, allowed) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.canEditDuties = !!allowed;
  writeDb(db);
  return { user: u };
}

// Editing the Training & Resources library (recipe cards, photos, videos,
// YouTube tutorials) — every manager-tier role gets this automatically (see
// requireTrainingEditAccess in src/middleware.js); this toggle is only for
// individually granting a specific Bar/Kitchen Staff member the same
// capability, same pattern as setUserCashSafeAccess/setUserDutiesEditAccess.
function setUserTrainingEditAccess(id, allowed) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.canEditTraining = !!allowed;
  writeDb(db);
  return { user: u };
}

function setUserAvatar(id, avatarPath) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  u.avatarPath = avatarPath || '';
  writeDb(db);
  return { user: u };
}

function setUserActive(id, active) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  if (u.role === 'admin' && u.active && !active && activeAdminCount(db) <= 1) {
    return { error: "Can't deactivate the last active admin." };
  }
  u.active = !!active;
  writeDb(db);
  return { user: u };
}

function setUserRole(id, role) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
  const newRole = normalizeRole(role);
  if (u.role === 'admin' && newRole !== 'admin' && activeAdminCount(db) <= 1) {
    return { error: "Can't remove admin rights from the last active admin." };
  }
  u.role = newRole;
  writeDb(db);
  return { user: u };
}

module.exports = {
  activeAdminCount, listUsers, getUserByEmail, getUserByUsername, getUserByPhone, getUserByLoginIdentifier,
  getUserById, createUser, updateUserProfile, setUserColor, setUserTimesheetAccess, setUserRosterAccess,
  setUserRequestsAccess, setUserFunctionBookingAccess, setUserNotificationsAccess, acceptPrivacyPolicy,
  setUserCashSafeAccess, setUserLogsAccess, setUserDutiesEditAccess, setUserTrainingEditAccess, setUserAvatar,
  setUserActive, setUserRole
};
