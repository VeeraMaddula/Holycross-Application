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
  const events = bookings.map(b => {
    const table = tables.find(t => t.id === b.tableId);
    const start = `${b.date}T${b.time}:00`;
    return {
      id: b.id,
      title: `${b.customerName} (${b.partySize}) - ${table ? table.name : ''}`,
      start,
      url: `/bookings/${b.id}`,
      color: b.status === 'seated' ? '#2f9e44' : b.status === 'confirmed' ? '#1c7ed6' : '#868e96'
    };
  });
  res.json(events);
});

module.exports = router;
