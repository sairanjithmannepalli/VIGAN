const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isPathAllowed } = require('../lib/pathGuard');

const ROOT = path.join('D:', 'Ai Projects', 'n8n');

test('allows the root itself', () => {
  assert.equal(isPathAllowed('.', ROOT), true);
});

test('allows a nested relative subpath', () => {
  assert.equal(isPathAllowed(path.join('src', 'index.js'), ROOT), true);
});

test('rejects a relative path that escapes the root', () => {
  assert.equal(isPathAllowed(path.join('..', 'other-project'), ROOT), false);
});

test('rejects a sibling directory with a matching name prefix', () => {
  const sibling = ROOT + '-evil';
  assert.equal(isPathAllowed(sibling, ROOT), false);
});

test('rejects an absolute path outside the root', () => {
  assert.equal(isPathAllowed(path.join('C:', 'Windows', 'System32'), ROOT), false);
});
