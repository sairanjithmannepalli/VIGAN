const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRegistry, resolveProject } = require('../lib/registry');

function writeTempRegistry(projects) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigan-registry-'));
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ projects }));
  return file;
}

test('loadRegistry parses a valid registry file', () => {
  const file = writeTempRegistry([{ name: 'Demo', path: '/tmp/demo' }]);
  const projects = loadRegistry(file);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'Demo');
});

test('loadRegistry rejects a file without a projects array', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigan-registry-'));
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ oops: true }));
  assert.throws(() => loadRegistry(file), /projects/);
});

test('resolveProject finds an exact case-insensitive match', () => {
  const projects = [
    { name: 'Product360', path: '/x' },
    { name: 'unified_app', path: '/y' },
  ];
  const { match } = resolveProject('product360', projects);
  assert.equal(match.name, 'Product360');
});

test('resolveProject suggests the closest name for a near miss', () => {
  const projects = [
    { name: 'Product360', path: '/x' },
    { name: 'unified_app', path: '/y' },
  ];
  const { match, suggestion } = resolveProject('Product 360', projects);
  assert.equal(match, null);
  assert.equal(suggestion.name, 'Product360');
});

test('resolveProject returns no suggestion for an unrelated name', () => {
  const projects = [{ name: 'Product360', path: '/x' }];
  const { match, suggestion } = resolveProject('zzz-not-a-project', projects);
  assert.equal(match, null);
  assert.equal(suggestion, null);
});
