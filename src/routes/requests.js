const express = require('express');
const router = express.Router();
const models = require('../models');
const { ROLE_LABELS } = require('../roles');
const notify = require('../notify');
const sms = require('../sms');
const { toDateStr, todayStr, formatTime12 } = require('../dateUtils');

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

// Notifies the chosen recipient by email + SMS that a request was sent to
// them. Fire-and-forget, same pattern as roster.js's notifyShift — sendEmail/
// sendSms log their own outcome and never throw.
function notifyRequest(request) {
  const recipient = request.recipient;
  if (!recipient) return;
  if (recipient.email) {
    const { subject, text } = notify.newRequestEmail(request);
    notify.sendEmail({ to: recipient.email, subject, text, type: 'staff-request' });
  }
  if (recipient.phone) {
    sms.sendSms({ to: recipient.phone, body: sms.newRequestSms(request), type: 'staff-request' });
  }
}

function recipientOptions(currentUserId) {
  return models.listUsers()
    .filter(u => u.active && u.id !== Number(currentUserId))
    .map(u => ({ id: u.id, name: u.name, roleLabel: ROLE_LABELS[u.role] || u.role }));
}

// This person's own upcoming shifts (next 4 weeks — same range My Shifts
// uses), flattened into a plain list for the "drop a shift" / "offer an
// exchange" dropdowns.
function myUpcomingShifts(userId) {
  const from = todayStr();
  const to = addDays(from, 27);
  const days = models.getUserUpcomingShifts(userId, from, to);
  const flat = [];
  days.forEach(day => day.shifts.forEach(s => flat.push(s)));
  return flat;
}

// Fire-and-forget notifications for a resolved shift drop (picked up
// outright or exchanged) — both parties by email + SMS, Managers by email
// only (FYI, no approval gate — see shiftDrops.js header comment).
function notifyShiftDropResolved({ kind, dropper, claimant, droppedShift, offerShift }) {
  if (kind === 'picked_up') {
    if (dropper && dropper.email) {
      const { subject, text } = notify.shiftDropPickedUpEmail(droppedShift, claimant.name);
      notify.sendEmail({ to: dropper.email, subject, text, type: 'shift-marketplace' });
    }
    if (dropper && dropper.phone) {
      sms.sendSms({ to: dropper.phone, body: sms.shiftDropPickedUpSms(droppedShift, claimant.name), type: 'shift-marketplace' });
    }
    if (claimant.email) {
      const { subject, text } = notify.shiftClaimedEmail(droppedShift, claimant.name);
      notify.sendEmail({ to: claimant.email, subject, text, type: 'shift-marketplace' });
    }
    if (claimant.phone) {
      sms.sendSms({ to: claimant.phone, body: sms.shiftClaimedSms(droppedShift), type: 'shift-marketplace' });
    }
  } else {
    // exchanged — dropper ends up on offerShift, claimant ends up on droppedShift
    if (dropper && dropper.email) {
      const { subject, text } = notify.shiftExchangeEmail(offerShift, dropper.name, droppedShift.date);
      notify.sendEmail({ to: dropper.email, subject, text, type: 'shift-marketplace' });
    }
    if (dropper && dropper.phone) {
      sms.sendSms({ to: dropper.phone, body: sms.shiftExchangeSms(offerShift, droppedShift.date), type: 'shift-marketplace' });
    }
    if (claimant.email) {
      const { subject, text } = notify.shiftExchangeEmail(droppedShift, claimant.name, offerShift.date);
      notify.sendEmail({ to: claimant.email, subject, text, type: 'shift-marketplace' });
    }
    if (claimant.phone) {
      sms.sendSms({ to: claimant.phone, body: sms.shiftExchangeSms(droppedShift, offerShift.date), type: 'shift-marketplace' });
    }
  }
  notify.notifyManagersShiftChange({
    kind,
    dropperName: dropper ? dropper.name : 'A staff member',
    claimantName: claimant.name,
    droppedShift,
    offerShift
  });
}

function marketplaceLocals(currentUserId) {
  return {
    openDrops: models.listOpenDrops(),
    myShifts: myUpcomingShifts(currentUserId).map(s => ({ ...s, startLabel: formatTime12(s.startTime), endLabel: formatTime12(s.endTime) })),
    currentUserId: Number(currentUserId)
  };
}

router.get('/', (req, res) => {
  const { sent, received } = models.listRequestsForUser(req.session.userId);
  res.render('requests', {
    sent, received,
    recipients: recipientOptions(req.session.userId),
    requestTypes: models.REQUEST_TYPES,
    formatTime12,
    ...marketplaceLocals(req.session.userId),
    error: req.query.error || null
  });
});

router.post('/', (req, res) => {
  const { type, details, recipientUserId } = req.body;
  const rerender = (status, error) => {
    const { sent, received } = models.listRequestsForUser(req.session.userId);
    return res.status(status).render('requests', {
      sent, received,
      recipients: recipientOptions(req.session.userId),
      requestTypes: models.REQUEST_TYPES,
      ...marketplaceLocals(req.session.userId),
      error
    });
  };

  if (!type || !details || !recipientUserId) {
    return rerender(400, 'Request type, recipient, and details are all required.');
  }

  const result = models.createRequest({
    type,
    details,
    requestedByUserId: req.session.userId,
    recipientUserId
  });
  if (result.error) {
    return rerender(400, result.error);
  }

  notifyRequest(result.request);
  res.redirect('/requests');
});

// ---- Shift Marketplace ----

router.post('/shift-drops', (req, res) => {
  const { shiftId } = req.body;
  const result = models.dropShift({ rosterShiftId: shiftId, userId: req.session.userId });
  const qs = result.error ? '?error=' + encodeURIComponent(result.error) : '';
  res.redirect(`/requests${qs}`);
});

router.post('/shift-drops/:id/cancel', (req, res) => {
  const result = models.cancelDrop(req.params.id, req.session.userId);
  const qs = result.error ? '?error=' + encodeURIComponent(result.error) : '';
  res.redirect(`/requests${qs}`);
});

router.post('/shift-drops/:id/pickup', (req, res) => {
  const result = models.pickUpDrop(req.params.id, req.session.userId);
  if (result.error) {
    return res.redirect(`/requests?error=${encodeURIComponent(result.error)}`);
  }
  notifyShiftDropResolved({
    kind: 'picked_up',
    dropper: result.dropper,
    claimant: result.claimant,
    droppedShift: result.drop.shift,
    offerShift: null
  });
  res.redirect('/requests');
});

router.post('/shift-drops/:id/exchange', (req, res) => {
  const { offerShiftId } = req.body;
  const result = models.exchangeDrop(req.params.id, req.session.userId, offerShiftId);
  if (result.error) {
    return res.redirect(`/requests?error=${encodeURIComponent(result.error)}`);
  }
  notifyShiftDropResolved({
    kind: 'exchanged',
    dropper: result.dropper,
    claimant: result.claimant,
    droppedShift: result.drop.shift,
    offerShift: result.drop.exchangeShift
  });
  res.redirect('/requests');
});

module.exports = router;
