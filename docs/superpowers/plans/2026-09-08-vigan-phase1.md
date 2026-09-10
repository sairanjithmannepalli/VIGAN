# VIGAN Phase 1 (Read-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only personal assistant, VIGAN, reachable from a local chat UI and from Slack, that can answer questions about a fixed list of D-drive projects (files, git status/log/diff) and proactively alerts one Slack user about important Gmail messages.

**Architecture:** A small, fully unit-tested Node.js CLI (`vigan/`) implements the only allowed capability — read-only filesystem and git access scoped to a project registry — and is invoked as a subprocess. Self-hosted n8n (installed standalone, not the source checkout in this repo) provides the orchestration: one shared "Agent Core" sub-workflow (AI Agent + memory + a tool that shells out to the CLI) is called by both a local Chat Trigger workflow and a Slack Trigger workflow, plus a separate scheduled workflow that polls Gmail read-only and pushes Slack alerts.

**Tech Stack:** Node.js (>=18, built-in `node:test` runner, zero npm dependencies), self-hosted n8n (standalone install), Anthropic Claude (via n8n's Anthropic credential), Slack app/bot, Gmail OAuth2 (readonly scope).

## Global Constraints

- Phase 1 is strictly read-only: no file writes, no script/build/test execution, no git-mutating commands, no Gmail send/delete/label mutation. (spec: "Phase 1 (Read-Only)")
- All project access must be confined to the paths listed in the project registry — nothing outside those roots is readable. (spec: "Project Registry", "Read-only project tool")
- All Slack messages (inbound handling, outbound sends) are restricted to exactly one allow-listed Slack user: Sai Ranjith Prasad. Never a channel, never any other user. (spec: "Slack integration")
- VIGAN is a single agent/persona everywhere (local chat and Slack) — no separate "Ganesh" identity. (spec: "Purpose")
- Email checking only happens while the local machine is awake and n8n is running — achieved by running n8n as a local, login-started process, not a cloud/always-on service. (spec: "Platform")
- Node.js must be >= 18 (required for the built-in `node:test` module used by all unit tests below).
- The existing n8n source checkout at `D:\Ai Projects\n8n\n8n` is NOT used to run VIGAN and is left untouched; VIGAN runs on a standalone n8n install (see Task 11).

---

## File Structure

```
D:\Ai Projects\n8n\
  vigan\
    package.json
    registry.json
    cli.js
    lib\
      registry.js
      pathGuard.js
      fsTool.js
      gitTool.js
    __tests__\
      registry.test.js
      pathGuard.test.js
      fsTool.test.js
      gitTool.test.js
      cli.test.js
    start-n8n.bat
  docs\
    vigan\
      setup.md
```

n8n workflows themselves (Tasks 6–10) are built directly in the n8n editor UI per the exact node configurations given in each task — there is no separate source file for them in this repo.

---

### Task 1: Project registry module

**Files:**
- Create: `vigan/package.json`
- Create: `vigan/registry.json`
- Create: `vigan/lib/registry.js`
- Test: `vigan/__tests__/registry.test.js`

**Interfaces:**
- Produces: `loadRegistry(registryPath: string): Array<{name: string, path: string}>`
- Produces: `resolveProject(name: string, projects: Array<{name, path}>): {match: {name, path} | null, suggestion: {name, path} | null}`
- Produces: `levenshtein(a: string, b: string): number`

- [ ] **Step 1: Create the package scaffold**

Create `vigan/package.json`:

```json
{
  "name": "vigan-tools",
  "version": "1.0.0",
  "private": true,
  "description": "Read-only project tools for the VIGAN n8n agent (Phase 1)",
  "main": "cli.js",
  "scripts": {
    "test": "node --test __tests__"
  }
}
```

- [ ] **Step 2: Create the project registry data file**

Create `vigan/registry.json`:

```json
{
  "projects": [
    { "name": "n8n", "path": "D:\\Ai Projects\\n8n" },
    { "name": "aiplay_project", "path": "D:\\Ai Projects\\aiplay_project" },
    { "name": "De-duplication", "path": "D:\\Ai Projects\\De-duplication" },
    { "name": "DevLinguist", "path": "D:\\Ai Projects\\DevLinguist" },
    { "name": "GitWorkSpace", "path": "D:\\Ai Projects\\GitWorkSpace" },
    { "name": "HACK", "path": "D:\\Ai Projects\\HACK" },
    { "name": "Meeting Assist", "path": "D:\\Ai Projects\\Meeting Assist" },
    { "name": "Product360", "path": "D:\\Ai Projects\\Product360" },
    { "name": "SPCC", "path": "D:\\Ai Projects\\SPCC" },
    { "name": "Vibe Coding Projects", "path": "D:\\Ai Projects\\Vibe Coding Projects" },
    { "name": "unified_app", "path": "D:\\unified_app" }
  ]
}
```

- [ ] **Step 3: Write the failing test**

Create `vigan/__tests__/registry.test.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd "D:\Ai Projects\n8n\vigan" && node --test __tests__/registry.test.js`
Expected: FAIL with `Cannot find module '../lib/registry'`

- [ ] **Step 5: Implement the registry module**

Create `vigan/lib/registry.js`:

```js
const fs = require('node:fs');

function loadRegistry(registryPath) {
  const raw = fs.readFileSync(registryPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.projects)) {
    throw new Error('registry.json must contain a "projects" array');
  }
  return data.projects;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function resolveProject(name, projects) {
  const normalized = name.trim().toLowerCase();
  const exact = projects.find((p) => p.name.toLowerCase() === normalized);
  if (exact) {
    return { match: exact, suggestion: null };
  }

  let best = null;
  let bestDistance = Infinity;
  for (const project of projects) {
    const distance = levenshtein(normalized, project.name.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = project;
    }
  }

  if (best && bestDistance <= 3) {
    return { match: null, suggestion: best };
  }

  return { match: null, suggestion: null };
}

module.exports = { loadRegistry, resolveProject, levenshtein };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd "D:\Ai Projects\n8n\vigan" && node --test __tests__/registry.test.js`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git init
git add vigan/package.json vigan/registry.json vigan/lib/registry.js vigan/__tests__/registry.test.js
git commit -m "feat(vigan): add project registry module"
```

(This is the first commit in this folder — `git init` only needs to run once; skip it in later tasks.)

---

### Task 2: Path guard module

**Files:**
- Create: `vigan/lib/pathGuard.js`
- Test: `vigan/__tests__/pathGuard.test.js`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces: `isPathAllowed(targetPath: string, allowedRoot: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `vigan/__tests__/pathGuard.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:\Ai Projects\n8n\vigan" && node --test __tests__/pathGuard.test.js`
Expected: FAIL with `Cannot find module '../lib/pathGuard'`

- [ ] **Step 3: Implement the path guard**

Create `vigan/lib/pathGuard.js`:

```js
const path = require('node:path');

function isPathAllowed(targetPath, allowedRoot) {
  const resolvedRoot = path.resolve(allowedRoot);
  const resolvedTarget = path.resolve(allowedRoot, targetPath);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(rootWithSep);
}

module.exports = { isPathAllowed };
```

Note: `path.resolve(allowedRoot, targetPath)` correctly handles the case where `targetPath` is itself absolute (e.g. `C:\Windows\System32`) — Node's `path.resolve` discards `allowedRoot` in that case and resolves to `targetPath` directly, which the subsequent `startsWith(rootWithSep)` check then correctly rejects.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "D:\Ai Projects\n8n\vigan" && node --test __tests__/pathGuard.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add vigan/lib/pathGuard.js vigan/__tests__/pathGuard.test.js
git commit -m "feat(vigan): add path guard to confine reads to a project root"
```

---

### Task 3: Filesystem read tool

**Files:**
- Create: `vigan/lib/fsTool.js`
- Test: `vigan/__tests__/fsTool.test.js`

**Interfaces:**
- Consumes: `isPathAllowed` from `vigan/lib/pathGuard.js` (Task 2)
- Produces: `listDir(root: string, subpath?: string): Array<{name: string, type: 'dir'|'file'}>`
- Produces: `readFile(root: string, subpath: string): {content: string, truncated: boolean, sizeBytes: number}`
- Produces: `searchFiles(root: string, subpath: string, pattern: string): {matches: Array<{file: string, line: number, text: string}>, truncated: boolean}`

**Security note (addresses a Task 2 review finding):** `isPathAllowed` only does lexical path checking, so a symlink or junction inside a project root that points outside it would otherwise be treated as "allowed." This task closes that gap two ways: (1) `assertAllowed` below re-validates with `fs.realpathSync` after the lexical check, so `listDir`/`readFile` reject any path that *resolves* outside the root even if it lexically appears inside it; (2) `searchFiles`' recursive walk skips symbolic links entirely rather than following them, so a symlinked subdirectory can never be traversed into.

- [ ] **Step 1: Write the failing test**

Create `vigan/__tests__/fsTool.test.js`:

```js
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
```

Creating symlinks on Windows can require Developer Mode or an elevated prompt; the two tests above detect that via the `EPERM`/`ENOSYS`-style error from `symlinkSync` and skip themselves with `t.skip(...)` rather than failing the suite when symlink creation isn't permitted on the machine running the tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:\Ai Projects\n8n\vigan" && node --test __tests__/fsTool.test.js`
Expected: FAIL with `Cannot find module '../lib/fsTool'`

- [ ] **Step 3: Implement the filesystem tool**

Create `vigan/lib/fsTool.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { isPathAllowed } = require('./pathGuard');

const MAX_FILE_BYTES = 200 * 1024;
const MAX_SEARCH_MATCHES = 200;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

function assertAllowed(root, subpath) {
  if (!isPathAllowed(subpath, root)) {
    throw new Error(`Path "${subpath}" is outside the allowed project root`);
  }
  const target = path.resolve(root, subpath);
  const resolvedRoot = fs.realpathSync(root);
  const resolvedTarget = fs.realpathSync(target);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootWithSep)) {
    throw new Error(`Path "${subpath}" resolves outside the allowed project root (symlink?)`);
  }
}

function listDir(root, subpath = '.') {
  assertAllowed(root, subpath);
  const target = path.resolve(root, subpath);
  const entries = fs.readdirSync(target, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? 'dir' : 'file',
  }));
}

function readFile(root, subpath) {
  assertAllowed(root, subpath);
  const target = path.resolve(root, subpath);
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    throw new Error(`"${subpath}" is a directory, not a file`);
  }
  const buffer = fs.readFileSync(target);
  const truncated = buffer.length > MAX_FILE_BYTES;
  const content = buffer.subarray(0, MAX_FILE_BYTES).toString('utf8');
  return { content, truncated, sizeBytes: buffer.length };
}

function searchFiles(root, subpath, pattern) {
  assertAllowed(root, subpath);
  const startDir = path.resolve(root, subpath);
  const regex = new RegExp(pattern, 'i');
  const matches = [];

  function walk(dir) {
    if (matches.length >= MAX_SEARCH_MATCHES) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= MAX_SEARCH_MATCHES) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;
      let text;
      try {
        text = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= MAX_SEARCH_MATCHES) break;
        if (regex.test(lines[i])) {
          matches.push({
            file: path.relative(root, fullPath),
            line: i + 1,
            text: lines[i].trim().slice(0, 200),
          });
        }
      }
    }
  }

  walk(startDir);
  return { matches, truncated: matches.length >= MAX_SEARCH_MATCHES };
}

module.exports = { listDir, readFile, searchFiles, MAX_FILE_BYTES, MAX_SEARCH_MATCHES };
```

`searchFiles` is a plain-text line grep (it reads each file as UTF-8); it is a Phase 1-appropriate approximation and may produce noisy matches on binary files, which is acceptable since this is a personal read-only tool, not a general-purpose search product. `assertAllowed`'s `fs.realpathSync` calls and `walk`'s `entry.isSymbolicLink()` check together mean a symlink or junction can never be used to read or search outside a project's registered root, even if it lexically appears to be inside it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "D:\Ai Projects\n8n\vigan" && node --test __tests__/fsTool.test.js`
Expected: PASS (7 tests) — or 5 passing + 2 skipped if the machine doesn't permit creating symlinks (see the note under Step 1's test file); either outcome is a clean run, never a failure

- [ ] **Step 5: Commit**

```bash
git add vigan/lib/fsTool.js vigan/__tests__/fsTool.test.js
git commit -m "feat(vigan): add read-only filesystem tool (list/read/search)"
```

---

### Task 4: Git read-only tool

**Files:**
- Create: `vigan/lib/gitTool.js`
- Test: `vigan/__tests__/gitTool.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (operates directly on a root path already validated by the CLI layer)
- Produces: `gitStatus(root: string): string`
- Produces: `gitLog(root: string, limit?: number): string`
- Produces: `gitDiff(root: string): string`

- [ ] **Step 1: Write the failing test**

Create `vigan/__tests__/gitTool.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:\Ai Projects\n8n\vigan" && node --test __tests__/gitTool.test.js`
Expected: FAIL with `Cannot find module '../lib/gitTool'`

- [ ] **Step 3: Implement the git tool**

Create `vigan/lib/gitTool.js`:

```js
const { execFileSync } = require('node:child_process');

function runGit(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(`git ${args.join(' ')} failed: ${err.message}`);
  }
}

function gitStatus(root) {
  return runGit(root, ['status', '--short', '--branch']);
}

function gitLog(root, limit = 20) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
  return runGit(root, ['log', '-n', String(safeLimit), '--oneline', '--decorate']);
}

function gitDiff(root) {
  return runGit(root, ['diff']);
}

module.exports = { gitStatus, gitLog, gitDiff };
```

`execFileSync` passes arguments as an array with no shell involved, so there is no shell-injection risk even though `root` ultimately originates from user-provided project names (the name is only ever used to look up a trusted path in `registry.json` — the raw user string never reaches `execFileSync`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "D:\Ai Projects\n8n\vigan" && node --test __tests__/gitTool.test.js`
Expected: PASS (5 tests) — requires `git` to be on PATH, which it already is on this machine.

- [ ] **Step 5: Commit**

```bash
git add vigan/lib/gitTool.js vigan/__tests__/gitTool.test.js
git commit -m "feat(vigan): add read-only git tool (status/log/diff)"
```

---

### Task 5: CLI entrypoint

**Files:**
- Create: `vigan/cli.js`
- Test: `vigan/__tests__/cli.test.js`

**Interfaces:**
- Consumes: `loadRegistry`, `resolveProject` (Task 1), `listDir`, `readFile`, `searchFiles` (Task 3), `gitStatus`, `gitLog`, `gitDiff` (Task 4)
- Produces: a CLI invoked as `node cli.js <command> [args...]` that prints one JSON object to stdout. Commands: `list-projects`, `list-dir <name> [subpath]`, `read-file <name> <subpath>`, `search <name> <subpath> <pattern>`, `git-status <name>`, `git-log <name> [limit]`, `git-diff <name>`. Reads the registry path from `process.env.VIGAN_REGISTRY_PATH`, defaulting to `vigan/registry.json` next to this file.

- [ ] **Step 1: Write the failing test**

Create `vigan/__tests__/cli.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'cli.js');

function makeFixtureRegistry() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vigan-cli-project-'));
  fs.writeFileSync(path.join(projectRoot, 'notes.txt'), 'hello from cli test\n');
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigan-cli-registry-'));
  const registryPath = path.join(registryDir, 'registry.json');
  fs.writeFileSync(
    registryPath,
    JSON.stringify({ projects: [{ name: 'Demo', path: projectRoot }] })
  );
  return { registryPath, projectRoot };
}

function runCli(args, registryPath) {
  const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, VIGAN_REGISTRY_PATH: registryPath },
  });
  return JSON.parse(stdout);
}

test('list-projects returns the registry names', () => {
  const { registryPath } = makeFixtureRegistry();
  const result = runCli(['list-projects'], registryPath);
  assert.deepEqual(result.projects, ['Demo']);
});

test('read-file returns content for a known project', () => {
  const { registryPath } = makeFixtureRegistry();
  const result = runCli(['read-file', 'Demo', 'notes.txt'], registryPath);
  assert.match(result.content, /hello from cli test/);
});

test('an unknown project name returns a JSON error, not a crash', () => {
  const { registryPath } = makeFixtureRegistry();
  let result;
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, 'list-dir', 'Nope', '.'], {
      encoding: 'utf8',
      env: { ...process.env, VIGAN_REGISTRY_PATH: registryPath },
    });
    result = JSON.parse(stdout);
  } catch (err) {
    result = JSON.parse(err.stdout);
  }
  assert.match(result.error, /Unknown project/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:\Ai Projects\n8n\vigan" && node --test __tests__/cli.test.js`
Expected: FAIL with `Cannot find module '../cli.js'` or ENOENT

- [ ] **Step 3: Implement the CLI**

Create `vigan/cli.js`:

```js
#!/usr/bin/env node
const path = require('node:path');
const { loadRegistry, resolveProject } = require('./lib/registry');
const { listDir, readFile, searchFiles } = require('./lib/fsTool');
const { gitStatus, gitLog, gitDiff } = require('./lib/gitTool');

const REGISTRY_PATH = process.env.VIGAN_REGISTRY_PATH || path.join(__dirname, 'registry.json');

function output(value) {
  process.stdout.write(JSON.stringify(value));
}

function fail(message) {
  output({ error: message });
  process.exitCode = 1;
}

function resolveOrFail(projects, name) {
  const { match, suggestion } = resolveProject(name, projects);
  if (match) return match;
  if (suggestion) {
    throw new Error(`Unknown project "${name}". Did you mean "${suggestion.name}"?`);
  }
  throw new Error(
    `Unknown project "${name}". Known projects: ${projects.map((p) => p.name).join(', ')}`
  );
}

function main() {
  const [, , command, ...args] = process.argv;
  const projects = loadRegistry(REGISTRY_PATH);

  try {
    switch (command) {
      case 'list-projects': {
        output({ projects: projects.map((p) => p.name) });
        break;
      }
      case 'list-dir': {
        const [name, subpath = '.'] = args;
        const project = resolveOrFail(projects, name);
        output({ project: project.name, entries: listDir(project.path, subpath) });
        break;
      }
      case 'read-file': {
        const [name, subpath] = args;
        const project = resolveOrFail(projects, name);
        output({ project: project.name, ...readFile(project.path, subpath) });
        break;
      }
      case 'search': {
        const [name, subpath, pattern] = args;
        const project = resolveOrFail(projects, name);
        output({ project: project.name, ...searchFiles(project.path, subpath, pattern) });
        break;
      }
      case 'git-status': {
        const [name] = args;
        const project = resolveOrFail(projects, name);
        output({ project: project.name, status: gitStatus(project.path) });
        break;
      }
      case 'git-log': {
        const [name, limit] = args;
        const project = resolveOrFail(projects, name);
        output({ project: project.name, log: gitLog(project.path, Number(limit)) });
        break;
      }
      case 'git-diff': {
        const [name] = args;
        const project = resolveOrFail(projects, name);
        output({ project: project.name, diff: gitDiff(project.path) });
        break;
      }
      default: {
        fail(
          `Unknown command "${command}". Valid commands: list-projects, list-dir, read-file, search, git-status, git-log, git-diff`
        );
      }
    }
  } catch (err) {
    fail(err.message);
  }
}

main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "D:\Ai Projects\n8n\vigan" && node --test __tests__/cli.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full test suite**

Run: `cd "D:\Ai Projects\n8n\vigan" && npm test`
Expected: PASS (all 23 tests across the 5 files)

- [ ] **Step 6: Commit**

```bash
git add vigan/cli.js vigan/__tests__/cli.test.js
git commit -m "feat(vigan): add CLI entrypoint wiring registry, fs and git tools"
```

---

### Task 6: n8n tool sub-workflow — "VIGAN Tool - Project Reader"

This wraps the CLI (Task 5) so the AI Agent (Task 7) can call it. Build this in the n8n editor UI (n8n was not yet installed for running VIGAN — do this as part of, or right after, Task 11's install step; the order here is logical, not execution order, since Tasks 6–10 all depend on Task 11's n8n install).

**Depends on:** Task 5 (`vigan/cli.js` must exist and pass its tests) and a running n8n instance (Task 11, step 1).

- [ ] **Step 1: Create the workflow and trigger**

In the n8n editor, create a new workflow named `VIGAN Tool - Project Reader`. Add an **Execute Workflow Trigger** node (search the node panel for "Execute Workflow Trigger" — this is the standard n8n node used to make a workflow callable as a sub-workflow/tool). Leave its input defined as a plain JSON object with these fields: `action`, `projectName`, `subpath`, `pattern`, `limit`.

- [ ] **Step 2: Add the "Build CLI Command" Code node**

Add a **Code** node after the trigger, named `Build CLI Command`, language JavaScript, mode "Run Once for Each Item":

```js
const CLI_PATH = 'D:\\Ai Projects\\n8n\\vigan\\cli.js';
const ALLOWED_ACTIONS = [
  'list-projects',
  'list-dir',
  'read-file',
  'search',
  'git-status',
  'git-log',
  'git-diff',
];

function quoteArg(value) {
  const str = String(value);
  if (/["\r\n]/.test(str)) {
    throw new Error(`Argument contains an unsupported character: ${str}`);
  }
  return `"${str}"`;
}

const input = $input.item.json;
const action = input.action;
if (!ALLOWED_ACTIONS.includes(action)) {
  throw new Error(`Unsupported action: ${action}`);
}

const args = [action];
if (input.projectName) args.push(quoteArg(input.projectName));
if (input.subpath) args.push(quoteArg(input.subpath));
if (input.pattern) args.push(quoteArg(input.pattern));
if (input.limit) args.push(quoteArg(input.limit));

return { command: `node ${quoteArg(CLI_PATH)} ${args.join(' ')}` };
```

This node is the shell-injection guard: the Execute Command node below runs through a shell, so every argument is rejected outright if it contains a double quote or newline, rather than being escaped and trusted.

- [ ] **Step 3: Add the Execute Command node**

Add an **Execute Command** node named `Run CLI`, with Command set to the expression `{{$json.command}}`.

- [ ] **Step 4: Add the "Parse CLI Output" Code node**

Add a **Code** node named `Parse CLI Output`, JavaScript, "Run Once for Each Item":

```js
const raw = $input.item.json.stdout || '';
try {
  return JSON.parse(raw);
} catch (err) {
  return { error: `Could not parse CLI output: ${err.message}. Raw output: ${raw.slice(0, 500)}` };
}
```

Connect: Execute Workflow Trigger → Build CLI Command → Run CLI → Parse CLI Output.

- [ ] **Step 5: Manually verify each action**

Use n8n's "Test workflow" with pinned input data on the trigger node, once per action, and confirm the final node's output JSON matches expectations:

- `{"action": "list-projects"}` → `{"projects": [...11 names...]}`
- `{"action": "list-dir", "projectName": "n8n", "subpath": "."}` → `{"project": "n8n", "entries": [...]}`
- `{"action": "read-file", "projectName": "n8n", "subpath": "hello-world-workflow.json"}` → `{"project": "n8n", "content": "...", "truncated": false, "sizeBytes": ...}`
- `{"action": "git-status", "projectName": "n8n"}` → `{"project": "n8n", "status": "..."}` (note: `D:\Ai Projects\n8n` itself is not a git repo — expect an `{"error": "...failed..."}` here, which is correct behavior; retry against `projectName: "n8n"` subpath `n8n` is not applicable since the tool only takes project names, so instead verify git actions against a project that IS a git repo, e.g. `"Product360"` if it has a `.git` folder, otherwise skip to Task 12's verification which picks a real git project)
- `{"action": "list-dir", "projectName": "totally-unknown"}` → `{"error": "Unknown project \"totally-unknown\". Known projects: ..."}`
- `{"action": "read-file", "projectName": "n8n", "subpath": "\" ; calc"}` → `{"error": "Argument contains an unsupported character: ..."}` (confirms the injection guard fires)

- [ ] **Step 6: Save**

Save the workflow as `VIGAN Tool - Project Reader`. Leave it inactive (it is only ever invoked as a sub-workflow, not on its own trigger).

---

### Task 7: n8n "VIGAN Agent Core" sub-workflow

The shared brain used by both the chat and Slack entry points.

**Depends on:** Task 6 (the tool sub-workflow must exist so it can be selected here) and n8n credentials for Anthropic (Task 11, step 6).

- [ ] **Step 1: Create the workflow and trigger**

Create a new workflow named `VIGAN Agent Core`. Add an **Execute Workflow Trigger** node with input fields `sessionId` and `message`.

- [ ] **Step 2: Add the AI Agent node**

Add an **AI Agent** node (search the node panel for "AI Agent"). Set:
- **Prompt / Text**: `{{$json.message}}`
- **System Message**:

```
You are VIGAN, a personal read-only assistant for Sai Ranjith Prasad. You can answer questions about the projects listed in the project registry by using the `read_project` tool. You must never claim to write files, run scripts, execute builds/tests, or make any git-mutating change — this is a Phase 1 read-only assistant. If asked to do any of those things, explain clearly that write/execute capability is planned for a future phase and is not available yet. When a project name given by the user does not match any known project, tell them the closest match you found (the tool will tell you) or list the known project names. Keep answers concise and specific, quoting relevant file paths, git status lines, or commit messages you retrieved via the tool rather than guessing.
```

- [ ] **Step 3: Add the chat model**

Add an **Anthropic Chat Model** sub-node attached to the AI Agent's Model input. Select (or create) the credential named `Anthropic - VIGAN` (Task 11, step 6). Model: the current Claude Sonnet model available in your credential's model list.

- [ ] **Step 4: Add memory**

Add a **Window Buffer Memory** sub-node attached to the AI Agent's Memory input. Set **Session Key** to the expression `{{$json.sessionId}}` and **Context Window Length** to `20`.

- [ ] **Step 5: Add the project-reader tool**

Add a **Call n8n Workflow Tool** sub-node attached to the AI Agent's Tool input. Configure:
- **Name**: `read_project`
- **Description**:

```
Read-only access to a fixed set of local projects. Actions: list-projects (no args), list-dir (projectName, subpath), read-file (projectName, subpath), search (projectName, subpath, pattern — regex, searches file contents line by line), git-status (projectName), git-log (projectName, limit), git-diff (projectName). Always call list-projects first if you are unsure of the exact project name. This tool cannot write, execute, or modify anything.
```

- **Workflow**: select `VIGAN Tool - Project Reader` (Task 6)
- **Input schema**: a JSON schema with fields `action` (string, required), `projectName` (string), `subpath` (string), `pattern` (string), `limit` (number) — matching what `Build CLI Command` (Task 6) expects.

- [ ] **Step 6: Shape the output**

Add a **Set** node after the AI Agent, named `Format Reply`, with a single field: `reply` = `{{$json.output}}` (the AI Agent node's default output field is `output`; if your installed n8n version names it differently, check the AI Agent node's output panel after a test run and adjust this expression to match).

Connect: Execute Workflow Trigger → AI Agent → Format Reply.

- [ ] **Step 7: Manually verify**

Test the workflow with pinned input `{"sessionId": "test-1", "message": "list the projects you know about"}` and confirm the final node outputs `{"reply": "..."}` naming all 11 registry projects. Then test `{"sessionId": "test-1", "message": "create a file called test.txt in Product360"}` and confirm the reply explains this is a Phase 1 read-only limitation rather than attempting the action.

- [ ] **Step 8: Save**

Save as `VIGAN Agent Core`. Leave it inactive (only invoked as a sub-workflow).

---

### Task 8: n8n "VIGAN - Chat" workflow (local entry point) — ✅ done (2026-09-10)

**Depends on:** Task 7.

- [x] **Step 1: Create the workflow and trigger**

Create a new workflow named `VIGAN - Chat`. Add a **Chat Trigger** node (from the `@n8n/n8n-nodes-langchain` package). Leave it in its default "Hosted Chat" mode so it serves a local webchat UI.

Confirmed actual Chat Trigger output fields: `action` ("sendMessage"), `sessionId`, `chatInput` — matches what this plan assumed.

- [x] **Step 2: Call the Agent Core**

Add an **Execute Workflow** node named `Call Agent Core` (search "Execute Workflow" specifically — searching just "Execute" can surface the unrelated Execute Command node instead):
- **Source**: `Database`, **Workflow**: `VIGAN Agent Core` (Task 7)

**Correction:** since `VIGAN Agent Core`'s trigger is left on "Accept All Data" (no explicit input fields defined), `Call Agent Core` shows no field-mapping UI — it just forwards whatever JSON reaches it wholesale. So a **`Prepare Input`** Set node was added *before* `Call Agent Core` (between it and the Chat Trigger) to reshape the data into exactly what Agent Core's internal expressions expect:
- `sessionId` = `{{$json.sessionId}}`
- `message` = `{{$json.chatInput}}`

Connect: Chat Trigger → `Prepare Input` → `Call Agent Core`.

- [x] **Step 3: Shape the chat response**

Add a **Set** node named `Format Chat Response` with a field `output` = `{{$json.reply}}` — confirmed `output` is the correct field name the Chat Trigger's UI looks for.

Connect: `Call Agent Core` → `Format Chat Response`.

- [x] **Step 4: Publish and verify**

n8n 2.x replaced the Active/Inactive toggle with a **Publish** button — click that instead. Open the Chat Trigger node and click "Open Chat" to get the local chat URL. Sent "what's the status of Product360?" and confirmed a correct, detailed reply describing real git status for that project.

- [x] **Step 5: Save**

Saved/published as `VIGAN - Chat`.

---

### Task 9: n8n "VIGAN - Slack" workflow (Slack entry point, single-recipient allow-list)

**Depends on:** Task 7, a Slack app/bot credential (Task 11, step 5), and the `VIGAN_SLACK_ALLOWED_USER_ID` environment variable (Task 11, step 3).

- [ ] **Step 1: Create the workflow and trigger**

Create a new workflow named `VIGAN - Slack`. Add a **Slack Trigger** node, credential `Slack - VIGAN Bot`, subscribed to direct-message events (event type `message.im`, or your n8n version's equivalent "Message" trigger scoped to DMs).

- [ ] **Step 2: Add the allow-list check**

Add an **IF** node named `Allow-list Check` with a condition: `{{$json.event.user}}` **is equal to** `{{$env.VIGAN_SLACK_ALLOWED_USER_ID}}`.

(Requires `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` to be set before n8n starts — see Task 11, step 3 — otherwise `$env` reads will be blocked and this condition will always fail closed.)

- [ ] **Step 3: True branch — call Agent Core and reply**

On the IF node's **true** output, add an **Execute Workflow** node `Call Agent Core`:
- **Workflow**: `VIGAN Agent Core`
- **Input**: `sessionId` = `slack-{{$json.event.user}}`, `message` = `{{$json.event.text}}`

Then add a **Slack** node `Send Reply`:
- **Credential**: `Slack - VIGAN Bot`
- **Operation**: Send Message
- **Channel**: `{{$json.event.channel}}` (the DM channel ID from the trigger event)
- **Text**: `{{$json.reply}}`

Connect: Allow-list Check (true) → Call Agent Core → Send Reply.

- [ ] **Step 4: False branch — do nothing**

Leave the IF node's **false** output unconnected. A message from any Slack user other than the allow-listed one is silently dropped — no reply, no log entry beyond n8n's own execution history.

- [ ] **Step 5: Activate and verify**

Activate the workflow. From your own Slack account, DM the VIGAN bot "what projects do you know about?" and confirm a reply. If you have a second Slack account or sandbox user available, DM the bot from that account and confirm no reply is sent (check the n8n execution list to confirm the run stopped at the IF node's false branch).

- [ ] **Step 6: Save**

Save as `VIGAN - Slack`.

---

### Task 10: n8n "VIGAN - Email Watcher" workflow (read-only Gmail polling + Slack alert)

**Depends on:** a Gmail OAuth2 credential scoped to `gmail.readonly` (Task 11, step 7) and the Slack bot credential (Task 11, step 5).

- [ ] **Step 1: Create the workflow and trigger**

Create a new workflow named `VIGAN - Email Watcher`. Add a **Schedule Trigger** node, Interval: every 15 minutes.

- [ ] **Step 2: Fetch recent unread mail (read-only)**

Add a **Gmail** node `Get Recent Mail`:
- **Credential**: `Gmail - VIGAN Read Only`
- **Operation**: Get Many (Messages)
- **Filters/Query**: `is:unread newer_than:1d`
- Leave "Mark as Read" (or equivalent) **off** — this must stay a non-mutating read.

- [ ] **Step 3: Classify importance**

Add a **Basic LLM Chain** node `Classify Importance` (from `@n8n/n8n-nodes-langchain`), model = the same Anthropic credential (`Anthropic - VIGAN`), prompt:

```
You are triaging email for urgency. Given the subject and snippet below, respond with strict JSON only, no other text: {"important": true or false, "reason": "<one short sentence>"}.

Subject: {{$json.subject}}
Snippet: {{$json.snippet}}
From: {{$json.from}}
```

- [ ] **Step 4: Parse the classification safely**

Add a **Code** node `Parse Classification`, JavaScript, "Run Once for Each Item":

```js
const raw = $input.item.json.text || $input.item.json.output || '';
try {
  const parsed = JSON.parse(raw);
  return { important: Boolean(parsed.important), reason: String(parsed.reason || '') };
} catch {
  return { important: false, reason: 'classification unparsable, defaulting to not important' };
}
```

This fails closed: any parsing problem defaults to `important: false`, so a malformed model response never causes a spurious alert.

- [ ] **Step 5: Alert on important mail**

Add an **IF** node `Is Important` on `{{$json.important}}` **is true**. On the true branch, add a **Slack** node `Send Alert`:
- **Credential**: `Slack - VIGAN Bot`
- **Channel**: the DM channel with the allow-listed user (use the same channel ID resolution as Task 9, or hardcode the DM channel ID once known from a prior Slack Trigger event)
- **Text**: `📧 Possibly important email from {{$json.from}}: "{{$json.subject}}" — {{$json.reason}}`

Leave the false branch unconnected.

Connect: Schedule Trigger → Get Recent Mail → Classify Importance → Parse Classification → Is Important → (true) → Send Alert.

- [ ] **Step 6: Activate and verify**

Activate the workflow. Wait for (or manually execute) one run and confirm in the n8n execution log that unimportant mail produces no Slack message, and — using a deliberately urgent-sounding test email sent to yourself — that an important one does produce a Slack alert.

- [ ] **Step 7: Save**

Save as `VIGAN - Email Watcher`.

---

### Task 11: Standalone n8n install, credentials, and login-start setup

**Files:**
- Create: `vigan/start-n8n.bat`
- Create: `docs/vigan/setup.md`

This task's steps are referenced by Tasks 6–10 above (they depend on the credentials and environment variables created here) — do this task first when actually executing the plan, even though it is written up last.

- [ ] **Step 1: Install a standalone n8n**

Run: `npm install -g n8n`

This installs the published n8n package used to actually run VIGAN. The n8n source checkout at `D:\Ai Projects\n8n\n8n` is a separate thing (n8n's own source code) and is not touched by this plan.

- [ ] **Step 2: Set the env-access flag**

n8n blocks `{{$env...}}` expressions in nodes by default. Set a system environment variable (PowerShell, run once as the logged-in user):

```powershell
[Environment]::SetEnvironmentVariable('N8N_BLOCK_ENV_ACCESS_IN_NODE', 'false', 'User')
```

- [ ] **Step 3: Create the Slack allow-list env var**

In Slack, open your own profile → "..." menu → "Copy member ID". Then:

```powershell
[Environment]::SetEnvironmentVariable('VIGAN_SLACK_ALLOWED_USER_ID', '<paste your member ID here>', 'User')
```

- [ ] **Step 4: Create the login-start script**

Create `vigan/start-n8n.bat`:

```bat
@echo off
n8n start
```

Create a shortcut to this file inside the Windows Startup folder (`Win+R` → `shell:startup`) so n8n starts automatically at login. This is what satisfies "checks email only when the system is awake": n8n (and therefore the Email Watcher's Schedule Trigger) simply is not running when you are logged off or the machine is asleep.

- [ ] **Step 5: Create the Slack app**

At `api.slack.com/apps` → Create New App → From scratch → name it `VIGAN`. Under OAuth & Permissions, add Bot Token Scopes: `chat:write`, `im:history`, `im:read`, `users:read`. Enable Event Subscriptions (or Socket Mode, per your n8n Slack Trigger node's requirements) for `message.im`. Install the app to your workspace and copy the Bot User OAuth Token. In n8n, create a Slack credential named `Slack - VIGAN Bot` using that token.

- [ ] **Step 6: Create the Anthropic credential**

In n8n, create an "Anthropic API" credential named `Anthropic - VIGAN` using your Anthropic API key.

- [ ] **Step 7: Create the Gmail read-only credential**

In Google Cloud Console, create an OAuth 2.0 Client ID restricted to the scope `https://www.googleapis.com/auth/gmail.readonly` only (do not grant send/modify/delete scopes). In n8n, create a Gmail credential named `Gmail - VIGAN Read Only`, connect it through that OAuth client, and confirm during the consent screen that only the read-only scope is being granted.

- [ ] **Step 8: Build Tasks 6–10**

With n8n running and all four credentials in place, build the four workflows described in Tasks 6, 7, 8, 9, and 10 in the n8n editor, in that order (each depends on the previous one existing).

- [ ] **Step 9: Write the setup doc**

Create `docs/vigan/setup.md` summarizing steps 1–8 above (so this doesn't need to be re-derived from the plan later):

```markdown
# VIGAN Phase 1 — Setup

1. `npm install -g n8n` (standalone install; do not use the source checkout in `n8n/n8n`)
2. Set env vars (User scope): `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, `VIGAN_SLACK_ALLOWED_USER_ID=<your Slack member ID>`
3. Put a shortcut to `vigan/start-n8n.bat` in `shell:startup` so n8n starts at login
4. Slack app "VIGAN": bot scopes `chat:write, im:history, im:read, users:read`, subscribe to `message.im`, credential name `Slack - VIGAN Bot`
5. Anthropic credential: `Anthropic - VIGAN`
6. Gmail credential (readonly scope only): `Gmail - VIGAN Read Only`
7. Build workflows in order: `VIGAN Tool - Project Reader` → `VIGAN Agent Core` → `VIGAN - Chat` → `VIGAN - Slack` → `VIGAN - Email Watcher`
8. Run `cd vigan && npm test` any time the CLI changes, before rebuilding the tool workflow
```

- [ ] **Step 10: Commit**

```bash
git add vigan/start-n8n.bat docs/vigan/setup.md
git commit -m "docs(vigan): add standalone n8n setup and login-start instructions"
```

---

### Task 12: End-to-end verification

**Depends on:** Tasks 1–11 all complete, all five workflows active.

- [ ] **Step 1: Local chat — known, misspelled, and unknown project names**

In the `VIGAN - Chat` webchat: ask "what's the status of Product360" and confirm the reply reflects real `git status` output for that path (or, if it's not a git repo, a clear statement of that). Ask "what's the status of producct360" (misspelled) and confirm the reply says something like "did you mean Product360?". Ask about "asdkjhasd" and confirm the reply lists the known project names instead of guessing.

- [ ] **Step 2: Slack allow-list**

DM the VIGAN Slack bot from your own account and confirm a reply. If a second Slack account is available, DM from it and confirm silence, cross-checked against the n8n execution log for that workflow (the run should stop at the `Allow-list Check` IF node's false branch).

- [ ] **Step 3: Refuse write/execute**

In chat, ask "create a new file called test.txt in Product360" and "run npm install in DevLinguist". Confirm VIGAN's replies explain this is Phase 1 read-only and does not attempt either action (and no file actually appears, no `node_modules` actually installs).

- [ ] **Step 4: Email only while awake**

Stop the n8n process (close the terminal it's running in, or log off) for at least one 15-minute Schedule Trigger interval. Send yourself an obviously urgent test email during that window. Confirm no Slack alert arrives while n8n is stopped. Restart n8n (or log back in) and confirm the next scheduled run does surface that email as a Slack alert.

- [ ] **Step 5: Cross-project summary**

Make an uncommitted edit in one project that is a git repo (e.g. add a line to a file in `DevLinguist` without committing). In chat, ask "which of my D-drive projects have uncommitted changes right now?" and confirm the reply correctly names that project and does not falsely flag projects with a clean tree.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(vigan): complete Phase 1 end-to-end verification"
```
