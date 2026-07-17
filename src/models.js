const crypto = require('crypto');
const { readDb, writeDb, DEFAULT_DATA } = require('./db');
const { ROLE_VALUES } = require('./roles');
const { toDateStr, todayStr } = require('./dateUtils');
const { normalizePhone, normalizePhoneWithCountryCode } = require('./phoneUtils');
const { hashPassword, verifyPassword } = require('./password');

function normalizeRole(role) {
  return ROLE_VALUES.includes(role) ? role : 'bar_staff';
}

// Default colour a new staff member gets on the roster grid (admin can change
// it any time from the Users page). Cycles through a curated palette so
// people are visually distinguishable even before anyone picks manually.
const COLOR_PALETTE = [
  '#c9a24b', '#7a8f6b', '#5b6b8c', '#b5543a', '#8a5fb3',
  '#3a8a8a', '#c96b96', '#4a7a3a', '#a67c52', '#5f5fa6'
];
function defaultColorForId(id) {
  return COLOR_PALETTE[(Number(id) - 1) % COLOR_PALETTE.length];
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function bookingRange(booking, slotDuration) {
  const start = toMinutes(booking.time);
  const duration = booking.durationMinutes || slotDuration;
  return { start, end: start + duration };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function minutesToHHMM(mins) {
  const wrapped = ((mins % 1440) + 1440) % 1440; // clip overnight overflow back onto a 24h clock for display
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildMusic(input) {
  const providedBy = input.musicProvidedBy || '';
  return {
    providedBy,
    providedByOther: providedBy === 'other' ? (input.musicProvidedByOther || '') : '',
    startTime: input.musicStart || '',
    endTime: input.musicEnd || '',
    types: [].concat(input.musicTypes || []).filter(Boolean),
    typesOther: input.musicTypesOther || '',
    artistName: input.musicArtistName || '',
    price: input.musicPrice ? Number(input.musicPrice) : 0
  };
}

const FOOD_COURSE_COUNTS = { two_course: 2, three_course: 3, four_course: 4 };

function buildFood(input) {
  const pkg = input.foodPackage || '';
  const courseCount = FOOD_COURSE_COUNTS[pkg] || 0;
  const courses = [];
  for (let i = 1; i <= 4; i++) {
    const name = input['foodCourse' + i + 'Name'];
    const price = input['foodCourse' + i + 'Price'];
    if (i <= courseCount && name && name.trim()) {
      courses.push({ name: name.trim(), price: price ? Number(price) : 0 });
    }
  }
  return {
    package: pkg,
    packageOther: pkg === 'other' ? (input.foodPackageOther || '') : '',
    price: input.foodPrice ? Number(input.foodPrice) : 0,
    courses
  };
}

// ---- Tables ----
function listTables() {
  return readDb().tables;
}

// Live occupancy for the Tables page: for each table, checks today's
// non-cancelled bookings against the current time. A table is "occupied"
// if right now falls inside a booking's start-to-start+duration window
// (same window logic booking conflict-detection already uses), "reserved"
// if nothing's active now but something's coming up later today, otherwise
// "available". This reads straight off existing booking data — no new
// fields, no external system, so it's accurate for anything booked through
// this app; it doesn't know about walk-ins that never got a booking record.
function getTablesWithStatus() {
  const db = readDb();
  const today = todayStr();
  const slotDuration = db.settings.slotDurationMinutes;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const todaysByTable = new Map();
  db.bookings.forEach(b => {
    if (b.date !== today || b.status === 'cancelled') return;
    if (!todaysByTable.has(b.tableId)) todaysByTable.set(b.tableId, []);
    todaysByTable.get(b.tableId).push(b);
  });

  return db.tables.map(t => {
    const todaysBookings = (todaysByTable.get(t.id) || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    const current = todaysBookings.find(b => {
      const r = bookingRange(b, slotDuration);
      return nowMinutes >= r.start && nowMinutes < r.end;
    });
    if (current) {
      const r = bookingRange(current, slotDuration);
      return {
        ...t,
        status: 'occupied',
        statusLabel: `Occupied · ${current.time}–${minutesToHHMM(r.end)}`,
        booking: current
      };
    }
    const upcoming = todaysBookings.find(b => bookingRange(b, slotDuration).start > nowMinutes);
    if (upcoming) {
      return { ...t, status: 'reserved', statusLabel: `Reserved · ${upcoming.time}`, booking: upcoming };
    }
    return { ...t, status: 'available', statusLabel: 'Available', booking: null };
  });
}

function createTable({ name, seats, area }) {
  const db = readDb();
  const table = { id: db.meta.nextTableId++, name, seats: Number(seats), area: area || 'Main Floor' };
  db.tables.push(table);
  writeDb(db);
  return table;
}

function deleteTable(id) {
  const db = readDb();
  db.tables = db.tables.filter(t => t.id !== Number(id));
  writeDb(db);
}

// ---- Bookings ----
function listBookings({ date, status } = {}) {
  const db = readDb();
  let bookings = db.bookings;
  if (date) bookings = bookings.filter(b => b.date === date);
  if (status) bookings = bookings.filter(b => b.status === status);
  return bookings.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

function getBooking(id) {
  const db = readDb();
  return db.bookings.find(b => b.id === Number(id));
}

function findConflict(db, candidate, excludeId) {
  const slotDuration = db.settings.slotDurationMinutes;
  const candRange = bookingRange(candidate, slotDuration);
  return db.bookings.find(b => {
    if (excludeId && b.id === excludeId) return false;
    if (b.status === 'cancelled') return false;
    if (b.date !== candidate.date) return false;
    if (b.tableId !== candidate.tableId) return false;
    const bRange = bookingRange(b, slotDuration);
    return overlaps(candRange, bRange);
  });
}

// `options.autoOverrideConflict` — true for Manager-or-above roles. If a
// conflict is found: managers still get their booking created and confirmed
// (the overlap is just noted in the history log); anyone else (Bar Staff)
// gets the booking created as 'pending_approval' instead of being rejected
// outright — a Manager/Floor Manager/Senior Manager then approves or
// declines it, and the customer isn't told anything is confirmed until then.
function createBooking(input, createdBy, options = {}) {
  const db = readDb();
  const candidate = {
    date: input.date,
    time: input.time,
    tableId: Number(input.tableId),
    durationMinutes: input.durationMinutes ? Number(input.durationMinutes) : undefined
  };

  const table = db.tables.find(t => t.id === candidate.tableId);
  if (!table) {
    return { error: 'Selected table does not exist.' };
  }
  if (Number(input.partySize) > table.seats) {
    return { error: `${table.name} only seats ${table.seats}. Choose a bigger table or split the party.` };
  }

  const conflict = findConflict(db, candidate);
  let status = 'confirmed';
  let historyEvent = `Booking created${createdBy ? ' by ' + createdBy.name : ''}`;
  if (conflict) {
    if (options.autoOverrideConflict) {
      historyEvent += ` — overlaps booking #${conflict.id} for ${conflict.customerName}, created anyway (Manager)`;
    } else {
      status = 'pending_approval';
      historyEvent += ` — overlaps booking #${conflict.id} for ${conflict.customerName}; awaiting Manager approval`;
    }
  }

  const booking = {
    id: db.meta.nextBookingId++,
    customerName: input.customerName,
    phone: input.phone || '',
    email: input.email || '',
    partySize: Number(input.partySize),
    date: input.date,
    time: input.time,
    durationMinutes: candidate.durationMinutes || db.settings.slotDurationMinutes,
    tableId: candidate.tableId,
    notes: input.notes || '',
    occasion: input.occasion || '',
    paymentStatus: input.paymentStatus || 'unpaid',
    depositAmount: input.depositAmount ? Number(input.depositAmount) : 0,
    music: buildMusic(input),
    food: buildFood(input),
    status,
    reminderSent: false,
    googleEventId: '',
    createdAt: new Date().toISOString(),
    createdByUserId: createdBy ? createdBy.id : null,
    createdByName: createdBy ? createdBy.name : '',
    history: [{ at: new Date().toISOString(), event: historyEvent }]
  };
  db.bookings.push(booking);
  writeDb(db);
  return { booking, conflict: conflict || null };
}

// Manager approves a Bar Staff booking that was held for a scheduling
// conflict. Only valid from 'pending_approval' — flips it to 'confirmed' so
// the usual confirmation email/SMS can go out to the customer.
function approveBooking(id, approvedBy) {
  const db = readDb();
  const booking = db.bookings.find(b => b.id === Number(id));
  if (!booking) return { error: 'Booking not found.' };
  if (booking.status !== 'pending_approval') return { error: 'This booking is not awaiting approval.' };
  booking.status = 'confirmed';
  booking.history.push({ at: new Date().toISOString(), event: `Approved by ${approvedBy ? approvedBy.name : 'a manager'}` });
  writeDb(db);
  return { booking };
}

function updateBooking(id, input) {
  const db = readDb();
  const booking = db.bookings.find(b => b.id === Number(id));
  if (!booking) return { error: 'Booking not found.' };

  const candidate = {
    date: input.date,
    time: input.time,
    tableId: Number(input.tableId),
    durationMinutes: input.durationMinutes ? Number(input.durationMinutes) : booking.durationMinutes
  };
  const table = db.tables.find(t => t.id === candidate.tableId);
  if (!table) return { error: 'Selected table does not exist.' };
  if (Number(input.partySize) > table.seats) {
    return { error: `${table.name} only seats ${table.seats}. Choose a bigger table or split the party.` };
  }
  const conflict = findConflict(db, candidate, booking.id);
  if (conflict) {
    return { error: `${table.name} is already booked for ${conflict.customerName} at ${conflict.time} on ${conflict.date}.` };
  }

  Object.assign(booking, {
    customerName: input.customerName,
    phone: input.phone || '',
    email: input.email || '',
    partySize: Number(input.partySize),
    date: input.date,
    time: input.time,
    durationMinutes: candidate.durationMinutes,
    tableId: candidate.tableId,
    notes: input.notes || '',
    occasion: input.occasion || '',
    paymentStatus: input.paymentStatus || 'unpaid',
    depositAmount: input.depositAmount ? Number(input.depositAmount) : 0,
    music: buildMusic(input),
    food: buildFood(input)
  });
  booking.reminderSent = false; // date/time may have changed, allow a fresh reminder
  booking.history.push({ at: new Date().toISOString(), event: 'Booking updated' });
  writeDb(db);
  return { booking };
}

function updatePayment(id, { paymentStatus, depositAmount }) {
  const db = readDb();
  const booking = db.bookings.find(b => b.id === Number(id));
  if (!booking) return { error: 'Booking not found.' };
  booking.paymentStatus = paymentStatus || 'unpaid';
  booking.depositAmount = depositAmount ? Number(depositAmount) : 0;
  booking.history.push({ at: new Date().toISOString(), event: `Payment status set to ${booking.paymentStatus}${booking.depositAmount ? ' (deposit: ' + booking.depositAmount + ')' : ''}` });
  writeDb(db);
  return { booking };
}

function setStatus(id, status) {
  const db = readDb();
  const booking = db.bookings.find(b => b.id === Number(id));
  if (!booking) return { error: 'Booking not found.' };
  booking.status = status;
  booking.history.push({ at: new Date().toISOString(), event: `Status changed to ${status}` });
  writeDb(db);
  return { booking };
}

function deleteBooking(id) {
  const db = readDb();
  db.bookings = db.bookings.filter(b => b.id !== Number(id));
  writeDb(db);
}

// ---- Menu / events ----
function getMenu() {
  return readDb().menu;
}
function saveMenu(menu) {
  const db = readDb();
  db.menu = menu;
  writeDb(db);
}
function listEvents() {
  return readDb().events.sort((a, b) => a.date.localeCompare(b.date));
}
function createEvent({ title, date, description }) {
  const db = readDb();
  const event = { id: db.meta.nextEventId++, title, date, description: description || '' };
  db.events.push(event);
  writeDb(db);
  return event;
}
function deleteEvent(id) {
  const db = readDb();
  db.events = db.events.filter(e => e.id !== Number(id));
  writeDb(db);
}

// ---- Notifications log ----
function logNotification({ type, bookingId, recipient, subject, text, status, error }) {
  const db = readDb();
  db.notifications.unshift({
    id: db.meta.nextNotificationId++,
    type,
    bookingId,
    recipient,
    subject,
    text: text || null,
    status,
    error: error || null,
    sentAt: new Date().toISOString()
  });
  db.notifications = db.notifications.slice(0, 500);
  writeDb(db);
}
function listNotifications(limit = 100) {
  return readDb().notifications.slice(0, limit);
}
function getNotification(id) {
  return readDb().notifications.find(n => n.id === Number(id));
}

function getSettings() {
  return readDb().settings;
}
function saveSettings(settings) {
  const db = readDb();
  db.settings = { ...db.settings, ...settings };
  writeDb(db);
  return db.settings;
}

// ---- Users ----
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

// ---- Forgot password (reset-by-email-link) ----
// Only the SHA-256 hash of the token is ever stored — same principle as
// passwords — so a leaked db.json doesn't hand out working reset links.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Looks the account up the same way login does (username/email/phone), then
// mints a one-time token good for 1 hour. Returns null if no account
// matches — callers should show the same generic "check your email" message
// either way, so this can't be used to discover which identifiers exist.
function createPasswordResetToken(identifier, countryCode) {
  const user = getUserByLoginIdentifier(identifier, countryCode);
  if (!user) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const db = readDb();
  const dbUser = db.users.find(u => u.id === user.id);
  if (!dbUser) return null;
  dbUser.resetTokenHash = hashResetToken(token);
  dbUser.resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  writeDb(db);
  return { user: dbUser, token };
}

function getUserByResetToken(token) {
  if (!token) return null;
  const hash = hashResetToken(token);
  const db = readDb();
  const user = (db.users || []).find(u => u.resetTokenHash === hash);
  if (!user) return null;
  if (!user.resetTokenExpiresAt || new Date(user.resetTokenExpiresAt).getTime() < Date.now()) return null;
  return user;
}

// Sets the new password and burns the token so the link can't be reused.
function resetPasswordWithToken(token, newPassword) {
  const user = getUserByResetToken(token);
  if (!user) return { error: 'This reset link is invalid or has expired. Request a new one.' };
  const db = readDb();
  const dbUser = db.users.find(u => u.id === user.id);
  dbUser.passwordHash = hashPassword(newPassword);
  delete dbUser.resetTokenHash;
  delete dbUser.resetTokenExpiresAt;
  writeDb(db);
  return { user: dbUser };
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

function setUserColor(id, color) {
  const db = readDb();
  const u = (db.users || []).find(x => x.id === Number(id));
  if (!u) return { error: 'User not found.' };
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

// ---- Google Calendar sync ----
function setBookingGoogleEventId(id, googleEventId) {
  const db = readDb();
  const b = db.bookings.find(x => x.id === Number(id));
  if (!b) return;
  b.googleEventId = googleEventId || '';
  writeDb(db);
}

function listExternalCalendarEvents() {
  return readDb().externalCalendarEvents || [];
}

function replaceExternalCalendarEvents(events) {
  const db = readDb();
  db.externalCalendarEvents = events;
  db.meta.lastGoogleSyncAt = new Date().toISOString();
  writeDb(db);
}

function getGoogleSyncStatus() {
  const db = readDb();
  return {
    lastSyncAt: db.meta.lastGoogleSyncAt || null,
    externalEventCount: (db.externalCalendarEvents || []).length
  };
}

// ---- Staff clock in / out ----
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

// ---- Kiosk clock-in PIN (separate from the login password — a short code
// staff punch in on the shared tablet) ----
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

// ---- Roster (direct per-date shifts, no recurring pattern) ----
// Design: every shift is pinned to one specific calendar date — there is no
// "repeats every week" layer. That's deliberate: a small bar/restaurant's
// staffing changes week to week (holidays, swaps, seasonal hours), so a
// recurring template just meant editing overrides on top of a template
// every week anyway. Assigning directly to a date is simpler and always
// shows exactly who's actually working.
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

// ---- Requests (staff -> staff/manager: stock, leave, other) ----
// Deliberately minimal first pass: pick a type, pick a specific recipient,
// write what you need — the recipient gets an email + text right away.
// Status tracking / approve-decline workflow can be layered on later.
const REQUEST_TYPES = [
  { value: 'stock', label: 'Stock' },
  { value: 'leave', label: 'Leave' },
  { value: 'other', label: 'Other' }
];
const REQUEST_TYPE_LABELS = Object.fromEntries(REQUEST_TYPES.map(t => [t.value, t.label]));

function createRequest({ type, details, requestedByUserId, recipientUserId }) {
  const db = readDb();
  if (!db.requests) db.requests = [];
  if (!db.meta.nextRequestId) db.meta.nextRequestId = 1;
  const requester = (db.users || []).find(u => u.id === Number(requestedByUserId));
  const recipient = (db.users || []).find(u => u.id === Number(recipientUserId));
  if (!recipient) return { error: 'Recipient not found.' };
  if (requester && requester.id === recipient.id) return { error: "You can't send a request to yourself." };
  const request = {
    id: db.meta.nextRequestId++,
    type,
    typeLabel: REQUEST_TYPE_LABELS[type] || 'Other',
    details: details || '',
    requestedByUserId: requester ? requester.id : Number(requestedByUserId),
    requestedByName: requester ? requester.name : 'Unknown',
    recipientUserId: recipient.id,
    recipientName: recipient.name,
    status: 'sent',
    createdAt: new Date().toISOString()
  };
  db.requests.push(request);
  writeDb(db);
  return { request: { ...request, recipient } };
}

// Requests you've sent and requests sent to you, newest first.
function listRequestsForUser(userId) {
  const db = readDb();
  const uid = Number(userId);
  const all = (db.requests || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    sent: all.filter(r => r.requestedByUserId === uid),
    received: all.filter(r => r.recipientUserId === uid)
  };
}

// ---- Admin danger-zone actions (Settings page, admin only) ----

// Clears all operational/transactional data — bookings, notification logs,
// clock-in history, roster shifts, staff requests, and pulled-in external
// calendar events — but leaves user accounts, tables, the menu, and
// settings untouched. For wiping demo/test activity without losing staff
// logins or the restaurant's configuration.
function clearOperationalData() {
  const db = readDb();
  db.bookings = [];
  db.notifications = [];
  db.timeEntries = [];
  db.rosterShifts = [];
  db.requests = [];
  db.externalCalendarEvents = [];
  db.meta.nextBookingId = 1;
  db.meta.nextNotificationId = 1;
  db.meta.nextTimeEntryId = 1;
  db.meta.nextRosterShiftId = 1;
  db.meta.nextRequestId = 1;
  db.meta.lastGoogleSyncAt = null;
  writeDb(db);
}

// Wipes EVERYTHING back to the app's defaults — tables, menu, bookings,
// notifications, every user account, all of it — then creates exactly one
// fresh admin account so there's always a way back in. Irreversible; the
// caller (routes/settings.js) is responsible for ending the current
// session afterwards since the account that was logged in no longer exists.
function factoryReset(adminEmail, adminPasswordHash) {
  const fresh = JSON.parse(JSON.stringify(DEFAULT_DATA));
  writeDb(fresh);
  return createUser({ name: 'Admin', email: adminEmail, passwordHash: adminPasswordHash, role: 'admin' });
}

module.exports = {
  clearOperationalData, factoryReset,
  listTables, getTablesWithStatus, createTable, deleteTable,
  listBookings, getBooking, createBooking, approveBooking, updateBooking, setStatus, updatePayment, deleteBooking,
  getMenu, saveMenu, listEvents, createEvent, deleteEvent,
  logNotification, listNotifications, getNotification,
  getSettings, saveSettings,
  listUsers, getUserByEmail, getUserByUsername, getUserByPhone, getUserByLoginIdentifier, getUserById, createUser, updateUserProfile, setUserActive, setUserRole, setUserAvatar, setUserTimesheetAccess, setUserRosterAccess, setUserRequestsAccess, setUserFunctionBookingAccess, setUserNotificationsAccess, setUserColor,
  createPasswordResetToken, getUserByResetToken, resetPasswordWithToken,
  setBookingGoogleEventId, listExternalCalendarEvents, replaceExternalCalendarEvents, getGoogleSyncStatus,
  getLatestClockEntry, getStaffStatus, nextValidAction, listAllStaffStatus, addClockEntry, listClockEntries,
  setUserPin, verifyUserPin, getKioskRoster, setUserLiveShiftAvatar,
  listRosterShiftsForRange, addRosterShift, updateRosterShift, removeRosterShift,
  getResolvedScheduleForRange, getUserUpcomingShifts,
  REQUEST_TYPES, createRequest, listRequestsForUser,
  toMinutes
};
