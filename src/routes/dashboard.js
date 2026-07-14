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

  // Who's currently on the clock, for the "working now" card. Only clocked-in
  // and on-break staff are shown here — clocked-out staff aren't relevant to
  // "who's working right now".
  const allStaffStatus = models.listAllStaffStatus();
  const workingNow = allStaffStatus.filter(s => s.status === 'clocked_in' || s.status === 'on_break');

  const stats = {
    todayCount: todayBookings.length,
    todayGuests: todayBookings.reduce((sum, b) => sum + b.partySize, 0),
    totalTables: tables.length,
    confirmedCount: allBookings.filter(b => b.status === 'confirmed').length,
    workingNowCount: workingNow.length,
    onBreakCount: workingNow.filter(s => s.status === 'on_break').length
  };

  res.render('dashboard', { todayBookings, upcoming, stats, tables, workingNow });
});

module.exports = router;
