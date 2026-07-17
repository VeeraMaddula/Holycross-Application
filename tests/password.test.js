const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, isValidPassword, PASSWORD_RULES } = require('../src/password');

test('hashPassword produces a salt:hash pair that verifies correctly', () => {
  const hash = hashPassword('Root@1234');
  assert.ok(hash.includes(':'));
  assert.equal(verifyPassword('Root@1234', hash), true);
});

test('verifyPassword rejects a wrong password', () => {
  const hash = hashPassword('Root@1234');
  assert.equal(verifyPassword('WrongPass@1', hash), false);
});

test('verifyPassword rejects malformed stored hashes safely', () => {
  assert.equal(verifyPassword('anything', ''), false);
  assert.equal(verifyPassword('anything', null), false);
  assert.equal(verifyPassword('anything', 'no-colon-here'), false);
});

test('two hashes of the same password are different (random salt) but both verify', () => {
  const h1 = hashPassword('Root@1234');
  const h2 = hashPassword('Root@1234');
  assert.notEqual(h1, h2);
  assert.equal(verifyPassword('Root@1234', h1), true);
  assert.equal(verifyPassword('Root@1234', h2), true);
});

test('isValidPassword enforces length + uppercase + lowercase + special char', () => {
  assert.equal(isValidPassword('Root@1234'), true); // valid
  assert.equal(isValidPassword('short1@'), false); // too short (7 chars)
  assert.equal(isValidPassword('alllowercase@1'), false); // no uppercase
  assert.equal(isValidPassword('ALLUPPERCASE@1'), false); // no lowercase
  assert.equal(isValidPassword('NoSpecialChar1'), false); // no special char
  assert.equal(isValidPassword('ThisPasswordIsWayTooLong@1'), false); // > 16 chars
  assert.equal(isValidPassword(123), false); // not a string
});

test('PASSWORD_RULES is a non-empty human-readable string', () => {
  assert.equal(typeof PASSWORD_RULES, 'string');
  assert.ok(PASSWORD_RULES.length > 10);
});
