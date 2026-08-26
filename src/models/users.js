// Staff/admin accounts: lookup, creation, profile edits, and the
// per-feature access-grant toggles set from the Users page. Kiosk PIN
// hashing/verification and password-reset/self-verification tokens live
// here too now (as columns on the users row) — moved in from
// clockEntries.js/passwordReset.js/selfVerification.js during the SQL
// migration, since those files no longer reach into the users table
// directly (see db/schema.sql). Every exported function here is now
// ASYNC (SQL, not synchronous JSON) — every caller must await it.
//
// Row shape returned by every function below is deliberately kept
// camelCase and field-compatible with the old JSON user object, so code
// elsewhere that reads e.g. user.pinHash or user.canViewTimesheets off a
// returned user didn't need to change, only the await did.
const { query } = require('../sqlPool');
const { normalizePhone, normalizePhoneWithCountryCode } = require('../phoneUtils');
const { normalizeRole, defaultColorForId } = require('./shared');

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    username: r.username || '',
    email: r.email,
    passwordHash: r.password_hash,
    phone: r.phone || '',
    dob: r.dob ? String(r.dob) : '',
    sex: r.sex || '',
    location: r.location || '',
    role: r.role,
    color: r.color,
    pinHash: r.pin_hash || '',
    active: r.active,
    avatarPath: r.avatar_path || '',
    liveShiftAvatarPath: r.live_shift_avatar_path || '',
    canViewTimesheets: r.can_view_timesheets,
    canManageRoster: r.can_manage_roster,
    canMakeRequests: r.can_make_requests,
    canBookFunctions: r.can_book_functions,
    canViewNotifications: r.can_view_notifications,
    canManageCashSafe: r.can_manage_cash_safe,
    canViewLogs: r.can_view_logs,
    canEditDuties: r.can_edit_duties,
    canEditTraining: r.can_edit_training,
    resetTokenHash: r.reset_token_hash || null,
    resetTokenExpiresAt: r.reset_token_expires_at ? new Date(r.reset_token_expires_at).toISOString() : null,
    selfVerifyCodeHash: r.self_verify_code_hash || null,
    selfVerifyPurpose: r.self_verify_purpose || null,
    selfVerifyExpiresAt: r.self_verify_expires_at ? new Date(r.self_verify_expires_at).toISOString() : null,
    privacyPolicyVersion: r.privacy_policy_version || null,
    privacyPolicyAcceptedAt: r.privacy_policy_accepted_at ? new Date(r.privacy_policy_accepted_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null
  };
}

async function activeAdminCount() {
  const { rows } = await query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active = true`);
  return rows[0].n;
}

async function listUsers() {
  const { rows } = await query(`SELECT * FROM users ORDER BY name ASC`);
  return rows.map(mapRow);
}

async function getUserByEmail(email) {
  const target = String(email || '').toLowerCase();
  const { rows } = await query(`SELECT * FROM users WHERE lower(email) = $1`, [target]);
  return mapRow(rows[0]);
}

async function getUserByUsername(username) {
  const target = String(username || '').trim().toLowerCase();
  if (!target) return null;
  const { rows } = await query(`SELECT * FROM users WHERE lower(username) = $1`, [target]);
  return mapRow(rows[0]);
}

// Matches a phone number typed at login (with an explicit country code from
// the dropdown) against stored user.phone values, comparing both in
// normalized E.164 form so formatting differences don't matter. There's no
// clean SQL equivalent for "compare after normalizing" across arbitrary
// stored formats, so this still pulls active phone numbers and compares in
// JS — fine at this app's scale (dozens of staff, not thousands).
async function getUserByPhone(phone, countryCode) {
  const target = normalizePhoneWithCountryCode(phone, countryCode);
  if (!target) return null;
  const { rows } = await query(`SELECT * FROM users WHERE phone IS NOT NULL AND phone <> ''`);
  const match = rows.find(r => normalizePhone(r.phone) === target);
  return mapRow(match);
}

// Login accepts username, phone number (with country code), or — for
// continuity with accounts created before usernames existed — email too.
async function getUserByLoginIdentifier(identifier, countryCode) {
  if (!identifier) return null;
  return (await getUserByUsername(identifier)) || (await getUserByEmail(identifier)) || (await getUserByPhone(identifier, countryCode));
}

async function getUserById(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [Number(id)]);
  return mapRow(rows[0]);
}

async function createUser({ name, username, email, passwordHash, role, phone, dob, sex, location }) {
  const normalizedRole = normalizeRole(role);
  const { rows } = await query(
    `INSERT INTO users (name, username, email, password_hash, role, phone, dob, sex, location, color, avatar_path, live_shift_avatar_path, pin_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'', '', '', '')
     RETURNING id`,
    [name, (username || '').trim(), String(email).toLowerCase(), passwordHash, normalizedRole,
      phone || '', dob || null, sex || '', location || '']
  );
  const id = rows[0].id;
  // Color depends on the id the DB just generated, so it's a follow-up
  // update rather than part of the INSERT above.
  await query(`UPDATE users SET color = $1 WHERE id = $2`, [defaultColorForId(id), id]);
  return getUserById(id);
}

// Edits the editable profile fields for an existing user (used from the
// Users > Edit page). Email and username uniqueness are re-checked since
// either can change.
async function updateUserProfile(id, { name, username, email, phone, dob, sex, location }) {
  const u = await getUserById(id);
  if (!u) return { error: 'User not found.' };
  let newEmail = u.email;
  let newUsername = u.username;
  if (email) {
    const target = String(email).toLowerCase();
    const { rows } = await query(`SELECT id FROM users WHERE lower(email) = $1 AND id <> $2`, [target, u.id]);
    if (rows.length) return { error: 'Another user already has that email.' };
    newEmail = target;
  }
  if (username) {
    const target = String(username).trim().toLowerCase();
    const { rows } = await query(`SELECT id FROM users WHERE lower(username) = $1 AND id <> $2`, [target, u.id]);
    if (rows.length) return { error: 'Another user already has that username.' };
    newUsername = String(username).trim();
  }
  await query(
    `UPDATE users SET name = $1, email = $2, username = $3, phone = $4, dob = $5, sex = $6, location = $7 WHERE id = $8`,
    [name || u.name, newEmail, newUsername, phone || '', dob || null, sex || '', location || '', u.id]
  );
  return { user: await getUserById(u.id) };
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

async function setUserColor(id, color) {
  const u = await getUserById(id);
  if (!u) return { error: 'User not found.' };
  if (color && !HEX_COLOR_RE.test(String(color).trim())) {
    return { error: 'Color must be a hex value like #4287f5.' };
  }
  const finalColor = color || defaultColorForId(u.id);
  await query(`UPDATE users SET color = $1 WHERE id = $2`, [finalColor, u.id]);
  return { user: await getUserById(u.id) };
}

// One helper for every boolean access-toggle column — same pattern as the
// old code's repeated readDb/find/set/writeDb blocks, just parameterized.
function makeAccessToggle(column) {
  return async function (id, allowed) {
    const u = await getUserById(id);
    if (!u) return { error: 'User not found.' };
    await query(`UPDATE users SET ${column} = $1 WHERE id = $2`, [!!allowed, u.id]);
    return { user: await getUserById(u.id) };
  };
}
const setUserTimesheetAccess = makeAccessToggle('can_view_timesheets');
const setUserRosterAccess = makeAccessToggle('can_manage_roster');
const setUserRequestsAccess = makeAccessToggle('can_make_requests');
const setUserFunctionBookingAccess = makeAccessToggle('can_book_functions');
const setUserNotificationsAccess = makeAccessToggle('can_view_notifications');
const setUserCashSafeAccess = makeAccessToggle('can_manage_cash_safe');
const setUserLogsAccess = makeAccessToggle('can_view_logs');
const setUserDutiesEditAccess = makeAccessToggle('can_edit_duties');
const setUserTrainingEditAccess = makeAccessToggle('can_edit_training');

async function acceptPrivacyPolicy(id, version) {
  const u = await getUserById(id);
  if (!u) return { error: 'User not found.' };
  await query(`UPDATE users SET privacy_policy_version = $1, privacy_policy_accepted_at = now() WHERE id = $2`, [version, u.id]);
  return { user: await getUserById(u.id) };
}

async function setUserAvatar(id, avatarPath) {
  const u = await getUserById(id);
  if (!u) return { error: 'User not found.' };
  await query(`UPDATE users SET avatar_path = $1 WHERE id = $2`, [avatarPath || '', u.id]);
  return { user: await getUserById(u.id) };
}

// Moved in from clockEntries.js — the avatar shown while actively clocked
// in (kiosk selfie), separate from the normal profile avatar.
async function setLiveShiftAvatar(id, avatarPath) {
  const u = await getUserById(id);
  if (!u) return { error: 'User not found.' };
  await query(`UPDATE users SET live_shift_avatar_path = $1 WHERE id = $2`, [avatarPath || '', u.id]);
  return { user: await getUserById(u.id) };
}

async function setUserActive(id, active) {
  const u = await getUserById(id);
  if (!u) return { error: 'User not found.' };
  if (u.role === 'admin' && u.active && !active && (await activeAdminCount()) <= 1) {
    return { error: "Can't deactivate the last active admin." };
  }
  await query(`UPDATE users SET active = $1 WHERE id = $2`, [!!active, u.id]);
  return { user: await getUserById(u.id) };
}

async function setUserRole(id, role) {
  const u = await getUserById(id);
  if (!u) return { error: 'User not found.' };
  const newRole = normalizeRole(role);
  if (u.role === 'admin' && newRole !== 'admin' && (await activeAdminCount()) <= 1) {
    return { error: "Can't remove admin rights from the last active admin." };
  }
  await query(`UPDATE users SET role = $1 WHERE id = $2`, [newRole, u.id]);
  return { user: await getUserById(u.id) };
}

// --- Kiosk PIN (moved in from clockEntries.js) ---
async function setUserPinHash(id, pinHash) {
  const u = await getUserById(id);
  if (!u) return { error: 'User not found.' };
  await query(`UPDATE users SET pin_hash = $1 WHERE id = $2`, [pinHash, u.id]);
  return { user: await getUserById(u.id) };
}

// --- Forgot-password-by-email token (moved in from passwordReset.js) ---
async function setUserResetToken(id, tokenHash, expiresAtIso) {
  await query(`UPDATE users SET reset_token_hash = $1, reset_token_expires_at = $2 WHERE id = $3`, [tokenHash, expiresAtIso, Number(id)]);
}
async function getUserByResetTokenHash(hash) {
  const { rows } = await query(`SELECT * FROM users WHERE reset_token_hash = $1`, [hash]);
  return mapRow(rows[0]);
}
async function clearUserResetToken(id) {
  await query(`UPDATE users SET reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = $1`, [Number(id)]);
}
async function setUserPasswordHash(id, passwordHash) {
  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, Number(id)]);
}

// --- Self-service verification code (moved in from selfVerification.js) ---
async function setUserSelfVerifyCode(id, { codeHash, purpose, expiresAtIso }) {
  await query(`UPDATE users SET self_verify_code_hash = $1, self_verify_purpose = $2, self_verify_expires_at = $3 WHERE id = $4`,
    [codeHash, purpose, expiresAtIso, Number(id)]);
}
async function clearUserSelfVerifyCode(id) {
  await query(`UPDATE users SET self_verify_code_hash = NULL, self_verify_purpose = NULL, self_verify_expires_at = NULL WHERE id = $1`, [Number(id)]);
}

module.exports = {
  activeAdminCount, listUsers, getUserByEmail, getUserByUsername, getUserByPhone, getUserByLoginIdentifier,
  getUserById, createUser, updateUserProfile, setUserColor, setUserTimesheetAccess, setUserRosterAccess,
  setUserRequestsAccess, setUserFunctionBookingAccess, setUserNotificationsAccess, acceptPrivacyPolicy,
  setUserCashSafeAccess, setUserLogsAccess, setUserDutiesEditAccess, setUserTrainingEditAccess, setUserAvatar,
  setLiveShiftAvatar, setUserActive, setUserRole, setUserPinHash, setUserResetToken, getUserByResetTokenHash,
  clearUserResetToken, setUserPasswordHash, setUserSelfVerifyCode, clearUserSelfVerifyCode
};
