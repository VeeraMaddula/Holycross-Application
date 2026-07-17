const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const testDb = require('./helpers/testDb');

testDb.setup('booking-approval'); // must happen before requiring ../src/db (via models)
const models = require('../src/models');

after(() => testDb.teardown());

const barStaff = { id: 2, name: 'Bar Bob', role: 'bar_staff' };
const floorMgr = { id: 3, name: 'Fiona Floor', role: 'floor_manager' };
const admin = { id: 1, name: 'Admin', role: 'admin' };

function freshBooking(overrides) {
  return Object.assign({
    customerName: 'Test Customer',
    partySize: 2,
    date: '2026-08-01',
    time: '18:00',
    tableId: 1
  }, overrides);
}

test('Bar Staff booking with no conflict is confirmed immediately', () => {
  const r = models.createBooking(freshBooking({ customerName: 'Alice' }), barStaff, { autoOverrideConflict: false });
  assert.equal(r.error, undefined);
  assert.equal(r.booking.status, 'confirmed');
  assert.equal(r.conflict, null);
});

test('Bar Staff booking that conflicts is held as pending_approval, not rejected', () => {
  models.createBooking(freshBooking({ customerName: 'Bob', time: '19:00' }), barStaff, { autoOverrideConflict: false });
  const r = models.createBooking(freshBooking({ customerName: 'Carla', time: '19:30' }), barStaff, { autoOverrideConflict: false });
  assert.equal(r.error, undefined);
  assert.equal(r.booking.status, 'pending_approval');
  assert.equal(r.conflict.customerName, 'Bob');
  assert.match(r.booking.history[0].event, /awaiting Manager approval/);
});

test('Manager booking that conflicts is auto-confirmed, no approval needed', () => {
  models.createBooking(freshBooking({ customerName: 'Dave', time: '20:00' }), barStaff, { autoOverrideConflict: false });
  const r = models.createBooking(freshBooking({ customerName: 'Erin', time: '20:30' }), floorMgr, { autoOverrideConflict: true });
  assert.equal(r.booking.status, 'confirmed');
  assert.match(r.booking.history[0].event, /created anyway \(Manager\)/);
});

test('approveBooking flips a pending booking to confirmed and logs the approver', () => {
  models.createBooking(freshBooking({ customerName: 'Frank', time: '21:00' }), barStaff, { autoOverrideConflict: false });
  const pending = models.createBooking(freshBooking({ customerName: 'Grace', time: '21:15' }), barStaff, { autoOverrideConflict: false });
  assert.equal(pending.booking.status, 'pending_approval');

  const approved = models.approveBooking(pending.booking.id, admin);
  assert.equal(approved.booking.status, 'confirmed');
  assert.ok(approved.booking.history.some(h => h.event.includes('Approved by Admin')));
});

test('approveBooking errors on a booking that is not pending', () => {
  const r = models.createBooking(freshBooking({ customerName: 'Henry', time: '22:00' }), admin, { autoOverrideConflict: true });
  const approveResult = models.approveBooking(r.booking.id, admin);
  assert.ok(approveResult.error);
});

test('approveBooking errors on an unknown booking id', () => {
  const r = models.approveBooking(999999, admin);
  assert.ok(r.error);
});

test('over-capacity bookings still error regardless of role', () => {
  const r = models.createBooking(freshBooking({ customerName: 'Big Party', partySize: 20 }), barStaff, { autoOverrideConflict: false });
  assert.ok(r.error);
});

test('a cancelled booking does not block a new one on the same slot', () => {
  const r1 = models.createBooking(freshBooking({ customerName: 'Ivy', time: '23:00', tableId: 5 }), barStaff, { autoOverrideConflict: false });
  models.setStatus(r1.booking.id, 'cancelled');
  const r2 = models.createBooking(freshBooking({ customerName: 'Jack', time: '23:00', tableId: 5 }), barStaff, { autoOverrideConflict: false });
  assert.equal(r2.booking.status, 'confirmed');
});
