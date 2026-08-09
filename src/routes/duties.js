const express = require('express');
const router = express.Router();
const models = require('../models');
const { todayStr } = require('../dateUtils');
const { requireDutiesEditAccess } = require('../middleware');
const { MANAGER_ROLES } = require('../roles');

// Defaults to today; a date query param lets anyone flip back and check a
// previous day's list (e.g. a manager reviewing yesterday's closing).
router.get('/', (req, res) => {
  const date = req.query.date || todayStr();
  const checklist = models.getDutiesChecklist(date);
  const u = res.locals.currentUser;
  const canEdit = !!(u && (MANAGER_ROLES.includes(u.role) || u.canEditDuties));
  res.render('duties', { checklist, today: todayStr(), canEdit, error: req.query.error || null });
});

router.post('/toggle', (req, res) => {
  const { date, taskId } = req.body;
  const u = res.locals.currentUser;
  if (date && taskId) {
    models.toggleDutyTask({ date, taskId, userId: u && u.id, userName: u && u.name });
  }
  res.redirect(`/duties?date=${encodeURIComponent(date || '')}`);
});

// ---- Editing the task list itself (add/rename/remove) — gated separately
// from the routes above, since ticking a task off and editing what the
// tasks even are are different levels of access (see requireDutiesEditAccess
// in src/middleware.js). ----

router.post('/tasks', requireDutiesEditAccess, (req, res) => {
  const { section, text, date } = req.body;
  const result = models.addDutyTask(section, text);
  const qs = 'date=' + encodeURIComponent(date || '') + (result.error ? '&error=' + encodeURIComponent(result.error) : '');
  res.redirect(`/duties?${qs}`);
});

router.post('/tasks/:id', requireDutiesEditAccess, (req, res) => {
  const { text, date } = req.body;
  const result = models.updateDutyTask(req.params.id, text);
  const qs = 'date=' + encodeURIComponent(date || '') + (result.error ? '&error=' + encodeURIComponent(result.error) : '');
  res.redirect(`/duties?${qs}`);
});

router.post('/tasks/:id/delete', requireDutiesEditAccess, (req, res) => {
  const { date } = req.body;
  const result = models.deleteDutyTask(req.params.id);
  const qs = 'date=' + encodeURIComponent(date || '') + (result.error ? '&error=' + encodeURIComponent(result.error) : '');
  res.redirect(`/duties?${qs}`);
});

module.exports = router;
