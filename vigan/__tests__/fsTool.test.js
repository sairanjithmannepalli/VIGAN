const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listDir, readFile, searchFiles } = require('../lib/fsTool');

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vigan-fs-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'function hello() {\n  return "hi";\n}\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\nhello world\n');
  return root;
}

test('listDir lists top-level entries', () => {
  const root = makeFixture();
  const entries = listDir(root, '.');
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['README.md', 'src']);
});

test('readFile returns file content and size', () => {
  const root = makeFixture();
  const result = readFile(root, 'README.md');
  assert.match(result.content, /Demo/);
  assert.equal(result.truncated, false);
});

test('readFile rejects a directory', () => {
  const root = makeFixture();
  assert.throws(() => readFile(root, 'src'), /directory/);
});

test('listDir rejects a path outside the project root', () => {
  const root = makeFixture();
  assert.throws(() => listDir(root, '..'), /outside/);
});

test('searchFiles finds matching lines across files', () => {
  const root = makeFixture();
  const { matches } = searchFiles(root, '.', 'hello');
  const files = new Set(matches.map((m) => m.file));
  assert.ok(files.has('README.md'));
  assert.ok(files.has(path.join('src', 'index.js')));
});

test('readFile rejects a symlink that resolves outside the project root', (t) => {
  const root = makeFixture();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigan-outside-'));
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'top secret\n');
  const linkPath = path.join(root, 'escape-link.txt');
  try {
    fs.symlinkSync(path.join(outsideDir, 'secret.txt'), linkPath, 'file');
  } catch (err) {
    t.skip(`cannot create symlinks on this system (${err.code}); skipping symlink-escape test`);
    return;
  }
  assert.throws(() => readFile(root, 'escape-link.txt'), /outside/);
});

test('searchFiles does not follow a symlinked directory out of the project root', (t) => {
  const root = makeFixture();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigan-outside-'));
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'hello secret\n');
  const linkDir = path.join(root, 'escape-dir');
  try {
    fs.symlinkSync(outsideDir, linkDir, 'dir');
  } catch (err) {
    t.skip(`cannot create symlinks on this system (${err.code}); skipping symlink-escape test`);
    return;
  }
  const { matches } = searchFiles(root, '.', 'hello');
  assert.ok(!matches.some((m) => m.file.startsWith('escape-dir')));
});
