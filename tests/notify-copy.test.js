// Pure template functions — no DB access, so no testDb setup needed here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const notify = require('../src/notify');
const sms = require('../src/sms');

const regularTable = { id: 1, name: 'Table 1', area: 'Main Floor', seats: 4 };
const functionRoom = { id: 34, name: 'Whitefield Room', area: 'Function Room', seats: 100 };
const booking = { customerName: 'Alice', partySize: 4, date: '2026-08-01', time: '18:00' };

test('confirmation email never names a regular table', () => {
  const { text } = notify.bookingConfirmationEmail(booking, regularTable);
  assert.doesNotMatch(text, /Table 1/);
});

test('confirmation email does name the room for a Function Room booking', () => {
  const { text } = notify.bookingConfirmationEmail(booking, functionRoom);
  assert.match(text, /Whitefield Room/);
});

test('confirmation email has the required copy elements', () => {
  const { text } = notify.bookingConfirmationEmail(booking, regularTable);
  assert.match(text, /warm welcome/i);
  assert.match(text, /\+353 51 353087/);
  assert.match(text, /facebook/i);
  assert.match(text, /both text and email/i);
});

test('reminder email also omits the table name unless it is a Function Room', () => {
  const regular = notify.bookingReminderEmail(booking, regularTable);
  assert.doesNotMatch(regular.text, /Table 1/);
  const fn = notify.bookingReminderEmail(booking, functionRoom);
  assert.match(fn.text, /Whitefield Room/);
});

test('confirmation SMS never names a regular table but does name the Function Room', () => {
  const regular = sms.bookingConfirmationSms(booking, regularTable);
  assert.doesNotMatch(regular, /Table 1/);
  const fn = sms.bookingConfirmationSms(booking, functionRoom);
  assert.match(fn, /Whitefield Room/);
});

test('pendingApprovalEmail names both the requester and the conflicting booking', () => {
  const b = { id: 5, createdByName: 'Bar Bob', customerName: 'New Customer', partySize: 3, date: '2026-08-01', time: '19:00' };
  const conflict = { customerName: 'Existing Customer', time: '19:15', date: '2026-08-01' };
  const { text } = notify.pendingApprovalEmail(b, regularTable, conflict);
  assert.match(text, /Bar Bob/);
  assert.match(text, /Existing Customer/);
  assert.match(text, /NOT been sent a confirmation/);
});
