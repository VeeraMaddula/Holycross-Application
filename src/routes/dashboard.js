const express = require('express');
const router = express.Router();
const models = require('../models');
const { todayStr } = require('../dateUtils');

router.get('/', (req, res) => {
  const today = todayStr();
  const todayBookings = models.listBookings({ date: today }).filter(b => b.status !== 'cancelled');

  const now = new Date();
  const upcoming = models.listBookings()
    .filter(b => b.status === 'confirmed' && new Date(`${b.date}T${b.time}:00`) >= now)
    .slice(0, 8);

  const tables = models.listTables();
  const allBookings = models.listBookings();
  const stats = {
    todayCount: todayBookings.length,
    todayGuests: todayBookings.reduce((sum, b) => sum + b.partySize, 0),
    totalTables: tables.length,
    confirmedCount: allBookings.filter(b => b.status === 'confirmed').length
  };

  res.render('dashboard', { todayBookings, upcoming, stats, tables });
});

module.exports = router;
