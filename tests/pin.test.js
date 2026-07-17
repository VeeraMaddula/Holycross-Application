const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const testDb = require('./helpers/testDb');

testDb.setup('pin'); // must happen before requiring ../src/db (via models)
const models = require('../src/models');
const notify = require('../src/notify');
const { hashPassword } = require('../src/password');

after(() => testDb.teardown());

function makeUser(overrides) {
  return models.createUser(Object.assign({
    name: 'Kiosk Test User',
    email: `pin.${Date.now()}.${Math.random()}@example.com`,
    passwordHash: hashPassword('Whatever@1'),
    role: 'bar_staff'
  }, overrides));
}

test('setUserPin rejects anything that is not exactly 4 digits', () => {
  const user = makeUser();
  assert.ok(models.setUserPin(user.id, '123').error);
  assert.ok(models.setUserPin(user.id, '12345').error);
  assert.ok(models.setUserPin(user.id, 'abcd').error);
  assert.ok(models.setUserPin(user.id, '').error);
});

test('setUserPin + verifyUserPin round-trip correctly', () => {
  const user = makeUser();
  const result = models.setUserPin(user.id, '4821');
  assert.equal(result.error, undefined);
  assert.equal(models.verifyUserPin(user.id, '4821'), true);
  assert.equal(models.verifyUserPin(user.id, '9999'), false);
});

test('verifyUserPin is false for a user with no PIN set', () => {
  const user = makeUser();
  assert.equal(models.verifyUserPin(user.id, '1234'), false);
});

test('verifyUserPin is false for an unknown user id', () => {
  assert.equal(models.verifyUserPin(999999, '1234'), false);
});

test('getKioskRoster reports hasPin correctly and excludes the kiosk/Bot account itself', () => {
  const withPin = makeUser({ name: 'Has Pin' });
  models.setUserPin(withPin.id, '1111');
  const withoutPin = makeUser({ name: 'No Pin' });
  makeUser({ name: 'Bot', role: 'kiosk' });

  const roster = models.getKioskRoster();
  const rosterIds = roster.map(r => r.id);
  assert.ok(rosterIds.includes(withPin.id));
  assert.ok(rosterIds.includes(withoutPin.id));

  const kioskUser = roster.find(r => r.name === 'Bot');
  assert.equal(kioskUser, undefined); // kiosk role is filtered out

  assert.equal(roster.find(r => r.id === withPin.id).hasPin, true);
  assert.equal(roster.find(r => r.id === withoutPin.id).hasPin, false);
});

test('pinResetRequestEmail names the user and points to the Users page', () => {
  const { subject, text } = notify.pinResetRequestEmail({ name: 'Nikita Karpenko' });
  assert.match(subject, /Nikita Karpenko/);
  assert.match(text, /Nikita Karpenko/);
  assert.match(text, /Users/);
});
