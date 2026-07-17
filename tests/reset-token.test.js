const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const testDb = require('./helpers/testDb');

testDb.setup('reset-token'); // must happen before requiring ../src/db (via models)
const models = require('../src/models');
const db = require('../src/db');
const { hashPassword, verifyPassword } = require('../src/password');

after(() => testDb.teardown());

function makeUser(overrides) {
  return models.createUser(Object.assign({
    name: 'Test User',
    email: 'test.user@example.com',
    passwordHash: hashPassword('OldPass@1'),
    role: 'bar_staff'
  }, overrides));
}

test('createPasswordResetToken returns null for an unknown identifier', () => {
  const result = models.createPasswordResetToken('nobody@nowhere.com', '+353');
  assert.equal(result, null);
});

test('createPasswordResetToken finds the user by email and returns a raw token', () => {
  makeUser({ email: 'lookup@example.com' });
  const result = models.createPasswordResetToken('lookup@example.com', '+353');
  assert.ok(result);
  assert.equal(result.user.email, 'lookup@example.com');
  assert.equal(typeof result.token, 'string');
  assert.ok(result.token.length >= 32);
});

test('the raw token is never stored in plain text on the user record', () => {
  makeUser({ email: 'secure@example.com' });
  const result = models.createPasswordResetToken('secure@example.com', '+353');
  const dbData = db.readDb();
  const stored = dbData.users.find(u => u.id === result.user.id);
  assert.notEqual(stored.resetTokenHash, result.token);
  assert.ok(stored.resetTokenHash.length === 64); // sha256 hex digest
});

test('getUserByResetToken resolves a valid token and rejects a bogus one', () => {
  makeUser({ email: 'valid@example.com' });
  const result = models.createPasswordResetToken('valid@example.com', '+353');
  const found = models.getUserByResetToken(result.token);
  assert.equal(found.id, result.user.id);
  assert.equal(models.getUserByResetToken('not-a-real-token'), null);
  assert.equal(models.getUserByResetToken(''), null);
});

test('getUserByResetToken rejects an expired token', () => {
  makeUser({ email: 'expired@example.com' });
  const result = models.createPasswordResetToken('expired@example.com', '+353');
  // Force the stored expiry into the past, same way the 1-hour TTL would
  // eventually lapse on its own.
  const dbData = db.readDb();
  const stored = dbData.users.find(u => u.id === result.user.id);
  stored.resetTokenExpiresAt = new Date(Date.now() - 1000).toISOString();
  db.writeDb(dbData);
  assert.equal(models.getUserByResetToken(result.token), null);
});

test('resetPasswordWithToken sets the new password and burns the token', () => {
  const user = makeUser({ email: 'reset@example.com' });
  const result = models.createPasswordResetToken('reset@example.com', '+353');

  const outcome = models.resetPasswordWithToken(result.token, 'NewPass@2');
  assert.equal(outcome.error, undefined);

  const dbData = db.readDb();
  const stored = dbData.users.find(u => u.id === user.id);
  assert.equal(verifyPassword('NewPass@2', stored.passwordHash), true);
  assert.equal(verifyPassword('OldPass@1', stored.passwordHash), false);
  assert.equal(stored.resetTokenHash, undefined);
  assert.equal(stored.resetTokenExpiresAt, undefined);

  // Token is one-time-use — reusing it must fail.
  const secondAttempt = models.resetPasswordWithToken(result.token, 'AnotherPass@3');
  assert.ok(secondAttempt.error);
});

test('resetPasswordWithToken errors on an invalid token', () => {
  const outcome = models.resetPasswordWithToken('totally-made-up-token', 'WhateverPass@1');
  assert.ok(outcome.error);
});
