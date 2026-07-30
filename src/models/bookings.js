// Bookings: creating, editing, approving, and conflict-checking table
// reservations — the core of the app.
const { readDb, writeDb } = require('../db');
const { bookingRange, overlaps, buildMusic, buildFood } = require('./shared');

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

// Picks a table for a public/website booking, where the customer never
// sees a table picker. Main Floor only — Function Room events go through
// staff directly, same restriction Bar Staff already have. Prefers the
// smallest table that actually fits the party (keeps bigger tables free),
// and among those prefers one with no existing conflict at that date/time.
// If every fitting table is already booked, still returns the smallest
// fitting one — createBooking's own conflict check will then correctly
// park it as pending_approval, which is what we want anyway (a manager
// needs to look at it either way for a public booking).
function findBestAvailableTable({ date, time, durationMinutes, partySize }) {
  const db = readDb();
  const duration = durationMinutes || db.settings.slotDurationMinutes;
  const fitting = db.tables
    .filter(t => t.area !== 'Function Room' && t.seats >= Number(partySize))
    .sort((a, b) => a.seats - b.seats);
  if (!fitting.length) return null;
  const candidate = { date, time, durationMinutes: duration };
  const free = fitting.find(t => !findConflict(db, { ...candidate, tableId: t.id }));
  return free || fitting[0];
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
  if (options.forcePendingApproval) {
    // Public/website bookings always wait for a Manager to approve, win or
    // lose on the conflict check — there's no staff member vetting it live.
    status = 'pending_approval';
    historyEvent = 'Booking request submitted via website — awaiting Manager approval'
      + (conflict ? ` (also overlaps booking #${conflict.id} for ${conflict.customerName})` : '');
  } else if (conflict) {
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
    createdByName: createdBy ? createdBy.name : (options.forcePendingApproval ? 'Website' : ''),
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

module.exports = {
  listBookings, getBooking, findConflict, findBestAvailableTable, createBooking,
  approveBooking, updateBooking, updatePayment, setStatus, deleteBooking
};
