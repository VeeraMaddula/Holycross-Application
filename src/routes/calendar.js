const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', (req, res) => {
  res.render('calendar');
});

// JSON feed consumed by the calendar view
router.get('/api/events', async (req, res) => {
  const [allBookings, tables, externalEvents] = await Promise.all([
    models.listBookings(),
    models.listTables(),
    models.listExternalCalendarEvents()
  ]);
  const bookings = allBookings.filter(b => b.status !== 'cancelled');
  const bookingEvents = bookings.map(b => {
    // String-compare, not === : table.id is a SQL-sourced string
    // (INT8-backed SERIAL) while b.tableId is a plain INT column.
    const table = tables.find(t => String(t.id) === String(b.tableId));
    const start = `${b.date}T${b.time}:00`;
    return {
      id: 'booking-' + b.id,
      title: `${b.customerName} (${b.partySize}) - ${table ? table.name : ''}`,
      start,
      url: `/bookings/${b.id}`,
      color: b.status === 'seated' ? '#2f9e44' : b.status === 'confirmed' ? '#1c7ed6' : '#868e96'
    };
  });

  // Events pulled in from Google Calendar that weren't created by this app
  // (e.g. someone added "Closed for private function" directly on the calendar).
  const externalCalEvents = externalEvents.map(e => ({
    id: 'gcal-' + e.id,
    title: `📅 ${e.title}`,
    start: e.start,
    end: e.end || undefined,
    color: '#868e96',
    editable: false
  }));

  res.json([...bookingEvents, ...externalCalEvents]);
});

module.exports = router;
