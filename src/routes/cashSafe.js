const express = require('express');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');

router.get('/', (req, res) => {
  const logs = models.listCashLogs();
  const balance = models.getCurrentSafeBalance();
  res.render('cash-safe', {
    logs,
    balance,
    starting: models.SAFE_STARTING_BALANCE,
    error: null
  });
});

router.post('/', async (req, res) => {
  const { reason, coinsIn, coinsOut, notesIn, notesOut } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).render('cash-safe', {
      logs: models.listCashLogs(),
      balance: models.getCurrentSafeBalance(),
      starting: models.SAFE_STARTING_BALANCE,
      error: 'Please give a reason for this cash safe change.'
    });
  }
  const u = res.locals.currentUser;
  const entry = models.addCashLog({
    reason,
    coinsIn, coinsOut, notesIn, notesOut,
    loggedByUserId: u && u.id,
    loggedByName: u && u.name
  });
  notify.notifySeniorManagerCashLog(entry).catch(() => {});
  res.redirect('/cash-safe');
});

module.exports = router;
