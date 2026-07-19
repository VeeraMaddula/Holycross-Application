// Syncs new staff sign-up rows (from the linked Google Sheet that collects
// the "Add New User" form responses) into the app's real user database.
// Safe to re-run any time — accounts already created (matched by username
// or email) are skipped automatically, so only genuinely new rows result
// in a new account. Used by the recurring "sync staff sign-ups" scheduled
// task, but can also be run by hand.
//
// Usage: node scripts/syncStaffFromSheet.js rows.json
//   rows.json: an array of objects with keys matching the sheet's columns —
//   { name, username, email, password, phone, dob, sex, location, role, pin }
//   dob may be "M/D/YYYY" (converted automatically) or already "YYYY-MM-DD".
const fs = require('fs');
const models = require('../src/models');
const { hashPassword } = require('../src/password');

const ROLE_MAP = {
  admin: 'admin', 'senior manager': 'senior_manager', 'general manager': 'general_manager',
  'staff manager': 'staff_manager', 'floor manager': 'floor_manager',
  'bar staff': 'bar_staff', 'kitchen staff': 'kitchen_staff'
};

// Anything that isn't an exact match to one of the app's real roles (e.g.
// "Waitress") falls back to Bar Staff, the closest fit — flagged in the
// summary rather than silently swallowed, so it's easy to reassign later.
function mapRole(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return ROLE_MAP[key] || 'bar_staff';
}

function normalizeDob(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function passwordIsCompliant(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 16
    && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node syncStaffFromSheet.js rows.json');
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

const created = [];
const skippedExisting = [];
const flagged = [];

for (const r of rows) {
  const name = (r.name || '').trim();
  const username = (r.username || '').trim();
  const email = (r.email || '').trim().toLowerCase();

  if (!name || !username || !email || !r.password || !r.phone) {
    flagged.push({ name: name || '(no name given)', notes: ['missing a required field (name/username/email/password/phone) — skipped, not created'] });
    continue;
  }
  if (models.getUserByUsername(username) || models.getUserByEmail(email)) {
    skippedExisting.push({ name, username });
    continue;
  }

  const role = mapRole(r.role);
  const notes = [];
  if (r.role && String(r.role).trim().toLowerCase() !== 'bar staff' && role === 'bar_staff' && !ROLE_MAP[String(r.role).trim().toLowerCase()]) {
    notes.push(`role "${r.role}" has no exact match in the app — mapped to Bar Staff`);
  }
  if (!passwordIsCompliant(r.password)) {
    notes.push('password does not meet the 8–16 char / upper+lower+special-character rule — created as given anyway');
  }

  const dob = normalizeDob(r.dob);
  const sex = String(r.sex || '').trim().toLowerCase();

  const user = models.createUser({
    name,
    username,
    email,
    passwordHash: hashPassword(r.password),
    role,
    phone: r.phone,
    dob,
    sex: ['male', 'female', 'other'].includes(sex) ? sex : '',
    location: r.location || ''
  });

  let pinSet = false;
  const pin = String(r.pin || '').trim();
  if (/^\d{4}$/.test(pin)) {
    const pinResult = models.setUserPin(user.id, pin);
    pinSet = !pinResult.error;
  } else if (r.pin) {
    notes.push('PIN was not exactly 4 digits — not set (can be added from Edit later)');
  }

  created.push({ id: user.id, name, username: user.username, role: user.role, pinSet, notes });
  if (notes.length) flagged.push({ name, notes });
}

console.log(JSON.stringify({ created, skippedExisting, flagged }, null, 2));
