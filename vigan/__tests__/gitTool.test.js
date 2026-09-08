const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gitStatus, gitLog, gitDiff } = require('../lib/gitTool');

function makeGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vigan-git-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'file.txt'), 'v1\n');
  execFileSync('git', ['add', 'file.txt'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: root });
  return root;
}

test('gitStatus reports a clean tree with no changes', () => {
  const root = makeGitRepo();
  const status = gitStatus(root);
  assert.doesNotMatch(status, /file\.txt/);
});

test('gitStatus reports a modified file', () => {
  const root = makeGitRepo();
  fs.writeFileSync(path.join(root, 'file.txt'), 'v2\n');
  const status = gitStatus(root);
  assert.match(status, /file\.txt/);
});

test('gitLog includes the commit message', () => {
  const root = makeGitRepo();
  const log = gitLog(root, 5);
  assert.match(log, /initial/);
});

test('gitDiff shows unstaged changes', () => {
  const root = makeGitRepo();
  fs.writeFileSync(path.join(root, 'file.txt'), 'v2\n');
  const diff = gitDiff(root);
  assert.match(diff, /v2/);
});

test('gitStatus throws a clear error for a non-git directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vigan-notgit-'));
  assert.throws(() => gitStatus(root), /failed/);
});
