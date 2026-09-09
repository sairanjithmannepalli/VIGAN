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
  const result = runCli(['list-dir', 'Nope', '.'], registryPath);
  assert.match(result.error, /Unknown project/);
});

test('search with no pattern argument returns a clear JSON error', () => {
  const { registryPath } = makeFixtureRegistry();
  const result = runCli(['search', 'Demo', '.'], registryPath);
  assert.match(result.error, /non-empty <pattern>/);
});

test('read-file with no subpath argument returns a clear JSON error', () => {
  const { registryPath } = makeFixtureRegistry();
  const result = runCli(['read-file', 'Demo'], registryPath);
  assert.match(result.error, /requires a <subpath>/);
});

test('list-dir with no arguments returns a clear JSON error', () => {
  const { registryPath } = makeFixtureRegistry();
  const result = runCli(['list-dir'], registryPath);
  assert.match(result.error, /requires a <projectName>/);
});
