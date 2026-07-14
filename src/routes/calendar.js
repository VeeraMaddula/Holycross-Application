const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', (req, res) => {
  res.render('calendar');
});

// JSON feed consumed by the calendar view
router.get('/api/events', (req, res) => {
  const bookings = models.listBookings().filter(b => b.status !== 'cancelled');
  const tables = models.listTables();
  const bookingEvents = bookings.map(b => {
    const table = tables.find(t => t.id === b.tableId);
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
  const externalEvents = models.listExternalCalendarEvents().map(e => ({
    id: 'gcal-' + e.id,
    title: `📅 ${e.title}`,
    start: e.start,
    end: e.end || undefined,
    color: '#868e96',
    editable: false
  }));

  res.json([...bookingEvents, ...externalEvents]);
});

module.exports = router;
