const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', (req, res) => {
  res.render('kiosk', { staff: models.getKioskRoster() });
});

// Lightweight status refresh for the tile grid — same polling pattern used
// on the Tables page, so a tile flips from "Clocked out" to "Present"
// automatically if someone clocks in on another device.
router.get('/status', (req, res) => {
  const roster = models.getKioskRoster().map(s => ({ id: s.id, status: s.status }));
  res.json(roster);
});

// Step 1: tap a tile, enter the PIN. Returns current status + which actions
// are valid next, so the client can render the right buttons.
router.post('/verify', (req, res) => {
  const { userId, pin } = req.body;
  const user = models.getUserById(userId);
  if (!user || !user.active || user.role === 'kiosk') {
    return res.status(400).json({ error: 'Staff member not found.' });
  }
  if (!user.pinHash) {
    return res.status(400).json({ error: 'No PIN set for this account yet — ask a manager to set one on the Users page.' });
  }
  if (!models.verifyUserPin(user.id, pin)) {
    return res.status(400).json({ error: 'Wrong PIN. Try again.' });
  }
  const status = models.getStaffStatus(user.id);
  res.json({ ok: true, status: status.status });
});

// Step 2: tap Clock In / Clock Out / Start Break / End Break. The PIN is
// re-checked server-side rather than trusting the client's earlier /verify
// call, so a tampered request can't skip straight to logging an action.
router.post('/action', (req, res) => {
  const { userId, pin, action } = req.body;
  const user = models.getUserById(userId);
  if (!user || !user.active || user.role === 'kiosk') {
    return res.status(400).json({ error: 'Staff member not found.' });
  }
  if (!models.verifyUserPin(user.id, pin)) {
    return res.status(400).json({ error: 'Wrong PIN.' });
  }
  const status = models.getStaffStatus(user.id);
  const allowed = models.nextValidAction(status.status);
  const allowedList = Array.isArray(allowed) ? allowed : [allowed].filter(Boolean);
  if (!allowedList.includes(action)) {
    return res.status(400).json({ error: 'That action is no longer available — please try again.' });
  }
  models.addClockEntry({ userId: user.id, userName: user.name, action, selfiePath: '' });
  res.json({ ok: true });
});

module.exports = router;
