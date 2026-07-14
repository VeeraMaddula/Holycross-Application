const express = require('express');
const router = express.Router();
const models = require('../models');
const { ROLE_LABELS } = require('../roles');
const notify = require('../notify');
const sms = require('../sms');

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

router.get('/', (req, res) => {
  const { sent, received } = models.listRequestsForUser(req.session.userId);
  res.render('requests', {
    sent, received,
    recipients: recipientOptions(req.session.userId),
    requestTypes: models.REQUEST_TYPES,
    error: null
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

module.exports = router;
