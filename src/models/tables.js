// Tables: the physical seating inventory (Main Floor + the two Function
// Rooms) and their live occupied/reserved/available status for today.
const { readDb, writeDb } = require('../db');
const { todayStr } = require('../dateUtils');
const { bookingRange, minutesToHHMM } = require('./shared');

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

module.exports = { listTables, getTablesWithStatus, createTable, deleteTable };
