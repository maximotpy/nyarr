const crypto = require('crypto');

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function generateApiKey() {
  return crypto.randomBytes(16).toString('hex');
}

function timingSafeStringEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

module.exports = { generateSalt, hashPassword, verifyPassword, generateApiKey, timingSafeStringEqual };
