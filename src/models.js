const { readDb, writeDb } = require('./db');

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

function createBooking(input) {
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
  if (conflict) {
    return { error: `${table.name} is already booked for ${conflict.customerName} at ${conflict.time} on ${conflict.date}.` };
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
    status: 'confirmed',
    reminderSent: false,
    createdAt: new Date().toISOString(),
    history: [{ at: new Date().toISOString(), event: 'Booking created' }]
  };
  db.bookings.push(booking);
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
function logNotification({ type, bookingId, recipient, subject, status, error }) {
  const db = readDb();
  db.notifications.unshift({
    id: db.meta.nextNotificationId++,
    type,
    bookingId,
    recipient,
    subject,
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

function getSettings() {
  return readDb().settings;
}
function saveSettings(settings) {
  const db = readDb();
  db.settings = { ...db.settings, ...settings };
  writeDb(db);
  return db.settings;
}

module.exports = {
  listTables, createTable, deleteTable,
  listBookings, getBooking, createBooking, updateBooking, setStatus, updatePayment, deleteBooking,
  getMenu, saveMenu, listEvents, createEvent, deleteEvent,
  logNotification, listNotifications,
  getSettings, saveSettings,
  toMinutes
};
