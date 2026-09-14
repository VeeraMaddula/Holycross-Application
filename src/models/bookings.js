// Bookings: creating, editing, approving, and conflict-checking table
// reservations — the core of the app.
//
// SQL-backed as of task #206 (bookings table — see db/schema.sql and
// db/010_redesign_bookings.sql, which added the columns the JSON model
// always carried — duration/occasion/payment/deposit/reminder/createdBy/
// history — and corrected `music` from TEXT to JSONB). Every exported
// function is now ASYNC.
//
// `settings` (slotDurationMinutes) is still read via readDb() — settings.js
// hasn't been converted yet — so this stays a mixed SQL-bookings/JSON-
// settings read for now, same transitional pattern used everywhere else in
// this migration.
const { readDb } = require('../db');
const { query } = require('../sqlPool');
const { bookingRange, overlaps, buildMusic, buildFood } = require('./shared');
const tablesModel = require('./tables');

const BOOKING_COLUMNS = `id, table_id, customer_name, phone, email, party_size,
  to_char(date, 'YYYY-MM-DD') AS date, time, duration_minutes, status, music, food,
  notes, occasion, payment_status, deposit_amount, reminder_sent, google_event_id,
  created_by_user_id, created_by_name, history, created_at, escalation_tier`;

// NUMERIC columns (deposit_amount) come back from `pg` as strings, same
// precision-safety reason INT8/SERIAL columns come back as strings — cast
// back to a JS number here so callers see exactly what the JSON model
// always gave them. music/food/history are JSONB — `pg` parses those into
// plain JS objects/arrays automatically, no manual JSON.parse needed.
function mapBookingRow(r) {
  return {
    id: r.id,
    tableId: r.table_id,
    customerName: r.customer_name,
    phone: r.phone || '',
    email: r.email || '',
    partySize: r.party_size,
    date: r.date,
    time: r.time,
    durationMinutes: r.duration_minutes,
    status: r.status,
    music: r.music || null,
    food: r.food || null,
    notes: r.notes || '',
    occasion: r.occasion || '',
    paymentStatus: r.payment_status,
    depositAmount: r.deposit_amount != null ? Number(r.deposit_amount) : 0,
    reminderSent: r.reminder_sent,
    googleEventId: r.google_event_id || '',
    createdByUserId: r.created_by_user_id,
    createdByName: r.created_by_name || '',
    history: r.history || [],
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    escalationTier: r.escalation_tier || 0
  };
}

async function listBookings({ date, status } = {}) {
  const conditions = [];
  const params = [];
  if (date) { params.push(date); conditions.push(`date = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // date/time are both sortable as plain strings ('YYYY-MM-DD'/'HH:MM'), so
  // ORDER BY date, time is equivalent to the JSON model's
  // (a.date+a.time).localeCompare(b.date+b.time).
  const { rows } = await query(`SELECT ${BOOKING_COLUMNS} FROM bookings ${where} ORDER BY date ASC, time ASC`, params);
  return rows.map(mapBookingRow);
}

async function getBooking(id) {
  const { rows } = await query(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1`, [Number(id)]);
  return rows[0] ? mapBookingRow(rows[0]) : null;
}

// Every booking's history entries flattened into one newest-first feed —
// each booking already keeps its own { at, event } audit trail (see
// createBooking/approveBooking/updateBooking/updatePayment/setStatus
// below); this just merges all of them for the manager-facing Logs page
// (src/routes/logs.js) instead of requiring a click into each booking.
async function listBookingHistory() {
  const { rows } = await query(
    `SELECT id, customer_name, to_char(date, 'YYYY-MM-DD') AS date, time, history FROM bookings`
  );
  const entries = [];
  rows.forEach(r => {
    (r.history || []).forEach(h => {
      entries.push({ at: h.at, event: h.event, bookingId: r.id, customerName: r.customer_name, date: r.date, time: r.time });
    });
  });
  return entries.sort((a, b) => new Date(b.at) - new Date(a.at));
}

// String-compare excludeId, not === : booking ids are SQL-sourced strings
// (INT8-backed SERIAL) — same mismatch class fixed throughout this
// migration (roster.js, shiftDrops.js).
async function findConflict(candidate, excludeId) {
  const db = readDb();
  const slotDuration = db.settings.slotDurationMinutes;
  const candRange = bookingRange(candidate, slotDuration);
  const { rows } = await query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE date = $1 AND table_id = $2 AND status <> 'cancelled'`,
    [candidate.date, Number(candidate.tableId)]
  );
  const bookings = rows.map(mapBookingRow);
  return bookings.find(b => {
    if (excludeId && String(b.id) === String(excludeId)) return false;
    const bRange = bookingRange(b, slotDuration);
    return overlaps(candRange, bRange);
  }) || null;
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
async function findBestAvailableTable({ date, time, durationMinutes, partySize }) {
  const db = readDb();
  const duration = durationMinutes || db.settings.slotDurationMinutes;
  const allTables = await tablesModel.listTables();
  const fitting = allTables
    .filter(t => t.area !== 'Function Room' && t.seats >= Number(partySize))
    .sort((a, b) => a.seats - b.seats);
  if (!fitting.length) return null;
  const candidate = { date, time, durationMinutes: duration };
  for (const t of fitting) {
    const conflict = await findConflict({ ...candidate, tableId: t.id });
    if (!conflict) return t;
  }
  return fitting[0];
}

// Same idea as findBestAvailableTable, but for the two actual Function
// Room entries (Whitefield Room seats 100, Butlerstone Room seats 50) —
// used by the public "Reserve a table" form's Function Room / private
// event option (see routes/publicBooking.js). Returns null if the party
// is bigger than even the larger room, so the caller can fall back to
// "please call us" for genuinely oversized events.
async function findBestAvailableFunctionRoom({ date, time, durationMinutes, partySize }) {
  const db = readDb();
  const duration = durationMinutes || db.settings.slotDurationMinutes;
  const allTables = await tablesModel.listTables();
  const fitting = allTables
    .filter(t => t.area === 'Function Room' && t.seats >= Number(partySize))
    .sort((a, b) => a.seats - b.seats);
  if (!fitting.length) return null;
  const candidate = { date, time, durationMinutes: duration };
  for (const t of fitting) {
    const conflict = await findConflict({ ...candidate, tableId: t.id });
    if (!conflict) return t;
  }
  return fitting[0];
}

// `options.autoOverrideConflict` — true for Manager-or-above roles. If a
// conflict is found: managers still get their booking created and confirmed
// (the overlap is just noted in the history log); anyone else (Bar Staff)
// gets the booking created as 'pending_approval' instead of being rejected
// outright — a Manager/Floor Manager/Senior Manager then approves or
// declines it, and the customer isn't told anything is confirmed until then.
async function createBooking(input, createdBy, options = {}) {
  const candidate = {
    date: input.date,
    time: input.time,
    tableId: Number(input.tableId),
    durationMinutes: input.durationMinutes ? Number(input.durationMinutes) : undefined
  };

  const table = await tablesModel.getTableById(candidate.tableId);
  if (!table) {
    return { error: 'Selected table does not exist.' };
  }
  if (Number(input.partySize) > table.seats) {
    return { error: `${table.name} only seats ${table.seats}. Choose a bigger table or split the party.` };
  }

  const conflict = await findConflict(candidate);
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

  const db = readDb();
  const finalDuration = candidate.durationMinutes || db.settings.slotDurationMinutes;
  const music = buildMusic(input);
  const food = buildFood(input);
  const history = [{ at: new Date().toISOString(), event: historyEvent }];

  const { rows } = await query(
    `INSERT INTO bookings (
       table_id, customer_name, phone, email, party_size, date, time, duration_minutes,
       status, music, food, notes, occasion, payment_status, deposit_amount,
       reminder_sent, google_event_id, created_by_user_id, created_by_name, history
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,'',$16,$17,$18)
     RETURNING ${BOOKING_COLUMNS}`,
    [
      candidate.tableId, input.customerName, input.phone || '', input.email || '',
      Number(input.partySize), input.date, input.time, finalDuration,
      status, JSON.stringify(music), JSON.stringify(food), input.notes || '', input.occasion || '',
      input.paymentStatus || 'unpaid', input.depositAmount ? Number(input.depositAmount) : 0,
      createdBy ? Number(createdBy.id) : null,
      createdBy ? createdBy.name : (options.forcePendingApproval ? 'Website' : ''),
      JSON.stringify(history)
    ]
  );
  const booking = mapBookingRow(rows[0]);
  return { booking, conflict: conflict || null };
}

// Manager approves a Bar Staff booking that was held for a scheduling
// conflict. Only valid from 'pending_approval' — flips it to 'confirmed' so
// the usual confirmation email/SMS can go out to the customer.
async function approveBooking(id, approvedBy) {
  const booking = await getBooking(id);
  if (!booking) return { error: 'Booking not found.' };
  if (booking.status !== 'pending_approval') return { error: 'This booking is not awaiting approval.' };
  const newHistory = [...booking.history, { at: new Date().toISOString(), event: `Approved by ${approvedBy ? approvedBy.name : 'a manager'}` }];
  const { rows } = await query(
    `UPDATE bookings SET status = 'confirmed', history = $1 WHERE id = $2 RETURNING ${BOOKING_COLUMNS}`,
    [JSON.stringify(newHistory), Number(id)]
  );
  return { booking: mapBookingRow(rows[0]) };
}

async function updateBooking(id, input) {
  const booking = await getBooking(id);
  if (!booking) return { error: 'Booking not found.' };

  const candidate = {
    date: input.date,
    time: input.time,
    tableId: Number(input.tableId),
    durationMinutes: input.durationMinutes ? Number(input.durationMinutes) : booking.durationMinutes
  };
  const table = await tablesModel.getTableById(candidate.tableId);
  if (!table) return { error: 'Selected table does not exist.' };
  if (Number(input.partySize) > table.seats) {
    return { error: `${table.name} only seats ${table.seats}. Choose a bigger table or split the party.` };
  }
  const conflict = await findConflict(candidate, booking.id);
  if (conflict) {
    return { error: `${table.name} is already booked for ${conflict.customerName} at ${conflict.time} on ${conflict.date}.` };
  }

  const music = buildMusic(input);
  const food = buildFood(input);
  // date/time may have changed, allow a fresh reminder — matches the JSON
  // model's `booking.reminderSent = false` on every update.
  const newHistory = [...booking.history, { at: new Date().toISOString(), event: 'Booking updated' }];

  const { rows } = await query(
    `UPDATE bookings SET
       customer_name = $1, phone = $2, email = $3, party_size = $4, date = $5, time = $6,
       duration_minutes = $7, table_id = $8, notes = $9, occasion = $10, payment_status = $11,
       deposit_amount = $12, music = $13, food = $14, reminder_sent = false, history = $15
     WHERE id = $16
     RETURNING ${BOOKING_COLUMNS}`,
    [
      input.customerName, input.phone || '', input.email || '', Number(input.partySize),
      input.date, input.time, candidate.durationMinutes, candidate.tableId,
      input.notes || '', input.occasion || '', input.paymentStatus || 'unpaid',
      input.depositAmount ? Number(input.depositAmount) : 0,
      JSON.stringify(music), JSON.stringify(food), JSON.stringify(newHistory), Number(id)
    ]
  );
  return { booking: mapBookingRow(rows[0]) };
}

async function updatePayment(id, { paymentStatus, depositAmount }) {
  const booking = await getBooking(id);
  if (!booking) return { error: 'Booking not found.' };
  const newPaymentStatus = paymentStatus || 'unpaid';
  const newDeposit = depositAmount ? Number(depositAmount) : 0;
  const newHistory = [...booking.history, { at: new Date().toISOString(), event: `Payment status set to ${newPaymentStatus}${newDeposit ? ' (deposit: ' + newDeposit + ')' : ''}` }];
  const { rows } = await query(
    `UPDATE bookings SET payment_status = $1, deposit_amount = $2, history = $3 WHERE id = $4 RETURNING ${BOOKING_COLUMNS}`,
    [newPaymentStatus, newDeposit, JSON.stringify(newHistory), Number(id)]
  );
  return { booking: mapBookingRow(rows[0]) };
}

async function setStatus(id, status) {
  const booking = await getBooking(id);
  if (!booking) return { error: 'Booking not found.' };
  const newHistory = [...booking.history, { at: new Date().toISOString(), event: `Status changed to ${status}` }];
  const { rows } = await query(
    `UPDATE bookings SET status = $1, history = $2 WHERE id = $3 RETURNING ${BOOKING_COLUMNS}`,
    [status, JSON.stringify(newHistory), Number(id)]
  );
  return { booking: mapBookingRow(rows[0]) };
}

async function deleteBooking(id) {
  await query(`DELETE FROM bookings WHERE id = $1`, [Number(id)]);
}

// Used by notify.js's reminder sweep once a reminder has actually gone out
// — kept as its own tiny setter (rather than routing through updateBooking)
// so a reminder send never touches the booking's audit history.
async function setReminderSent(id) {
  await query(`UPDATE bookings SET reminder_sent = true WHERE id = $1`, [Number(id)]);
}

// Records that a given escalation tier's reminder has gone out for a
// pending_approval booking (see runBookingApprovalEscalationSweep in
// notify.js), so the next sweep tick doesn't re-notify the same tier.
async function setEscalationTier(id, tier) {
  await query(`UPDATE bookings SET escalation_tier = $1 WHERE id = $2`, [tier, Number(id)]);
}

module.exports = {
  listBookings, getBooking, findConflict, findBestAvailableTable, findBestAvailableFunctionRoom, createBooking,
  approveBooking, updateBooking, updatePayment, setStatus, deleteBooking, listBookingHistory,
  setReminderSent, setEscalationTier
};
