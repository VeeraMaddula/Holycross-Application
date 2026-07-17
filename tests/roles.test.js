const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROLES, ROLE_VALUES, ROLE_LABELS, MANAGER_ROLES } = require('../src/roles');
const bookingsRouter = require('../src/routes/bookings');

const canBookFunctionRoom = bookingsRouter.canBookFunctionRoom;

test('ROLES/ROLE_VALUES/ROLE_LABELS stay in sync', () => {
  assert.equal(ROLE_VALUES.length, ROLES.length);
  ROLES.forEach(r => {
    assert.ok(ROLE_VALUES.includes(r.value));
    assert.equal(ROLE_LABELS[r.value], r.label);
  });
});

test('MANAGER_ROLES contains exactly the manager-tier roles', () => {
  assert.deepEqual(
    [...MANAGER_ROLES].sort(),
    ['admin', 'floor_manager', 'general_manager', 'senior_manager', 'staff_manager'].sort()
  );
  assert.ok(!MANAGER_ROLES.includes('bar_staff'));
  assert.ok(!MANAGER_ROLES.includes('kitchen_staff'));
  assert.ok(!MANAGER_ROLES.includes('kiosk'));
});

test('canBookFunctionRoom: Bar Staff is always blocked, even with the grant', () => {
  assert.equal(canBookFunctionRoom({ role: 'bar_staff', canBookFunctions: true }), false);
  assert.equal(canBookFunctionRoom({ role: 'bar_staff', canBookFunctions: false }), false);
});

test('canBookFunctionRoom: Admin and Senior Manager are always allowed', () => {
  assert.equal(canBookFunctionRoom({ role: 'admin' }), true);
  assert.equal(canBookFunctionRoom({ role: 'senior_manager' }), true);
});

test('canBookFunctionRoom: other roles need the explicit grant', () => {
  assert.equal(canBookFunctionRoom({ role: 'floor_manager' }), false);
  assert.equal(canBookFunctionRoom({ role: 'floor_manager', canBookFunctions: true }), true);
  assert.equal(canBookFunctionRoom({ role: 'kitchen_staff' }), false);
});

test('canBookFunctionRoom: no user is blocked', () => {
  assert.equal(canBookFunctionRoom(null), false);
  assert.equal(canBookFunctionRoom(undefined), false);
});
