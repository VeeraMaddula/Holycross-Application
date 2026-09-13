const express = require('express');
const router = express.Router();
const models = require('../models');
const { todayStr } = require('../dateUtils');
const { MANAGER_ROLES } = require('../roles');

router.get('/', async (req, res) => {
  const today = todayStr();

  const [todayBookingsRaw, pendingApprovalBookings, allBookings, tables, allStaffStatus] = await Promise.all([
    models.listBookings({ date: today }),
    MANAGER_ROLES.includes((res.locals.currentUser || {}).role) ? models.listBookings({ status: 'pending_approval' }) : Promise.resolve([]),
    models.listBookings(),
    models.listTables(),
    models.listAllStaffStatus()
  ]);
  const todayBookings = todayBookingsRaw.filter(b => b.status !== 'cancelled');

  const now = new Date();
  const upcoming = allBookings
    .filter(b => b.status === 'confirmed' && new Date(`${b.date}T${b.time}:00`) >= now)
    .slice(0, 8);

  // Who's currently on the clock, for the "working now" card. Only clocked-in
  // and on-break staff are shown here — clocked-out staff aren't relevant to
  // "who's working right now".
  const workingNow = allStaffStatus.filter(s => s.status === 'clocked_in' || s.status === 'on_break');

  const stats = {
    todayCount: todayBookings.length,
    todayGuests: todayBookings.reduce((sum, b) => sum + b.partySize, 0),
    totalTables: tables.length,
    confirmedCount: allBookings.filter(b => b.status === 'confirmed').length,
    workingNowCount: workingNow.length,
    onBreakCount: workingNow.filter(s => s.status === 'on_break').length
  };

  res.render('dashboard', { todayBookings, upcoming, stats, tables, workingNow, pendingApprovalBookings });
});

module.exports = router;
