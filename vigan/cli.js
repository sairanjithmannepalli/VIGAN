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

function requireArg(value, message) {
  if (value === undefined || value === null || value === '') {
    throw new Error(message);
  }
  return value;
}

function main() {
  const [, , command, ...args] = process.argv;

  try {
    const projects = loadRegistry(REGISTRY_PATH);
    switch (command) {
      case 'list-projects': {
        output({ projects: projects.map((p) => p.name) });
        break;
      }
      case 'list-dir': {
        const [name, subpath = '.'] = args;
        requireArg(name, 'list-dir requires a <projectName> argument');
        const project = resolveOrFail(projects, name);
        output({ project: project.name, entries: listDir(project.path, subpath) });
        break;
      }
      case 'read-file': {
        const [name, subpath] = args;
        requireArg(name, 'read-file requires a <projectName> argument');
        requireArg(subpath, 'read-file requires a <subpath> argument');
        const project = resolveOrFail(projects, name);
        output({ project: project.name, ...readFile(project.path, subpath) });
        break;
      }
      case 'search': {
        const [name, subpath, pattern] = args;
        requireArg(name, 'search requires a <projectName> argument');
        requireArg(subpath, 'search requires a <subpath> argument');
        requireArg(pattern, 'search requires a non-empty <pattern> argument');
        const project = resolveOrFail(projects, name);
        output({ project: project.name, ...searchFiles(project.path, subpath, pattern) });
        break;
      }
      case 'git-status': {
        const [name] = args;
        requireArg(name, 'git-status requires a <projectName> argument');
        const project = resolveOrFail(projects, name);
        output({ project: project.name, status: gitStatus(project.path) });
        break;
      }
      case 'git-log': {
        const [name, limit] = args;
        requireArg(name, 'git-log requires a <projectName> argument');
        const project = resolveOrFail(projects, name);
        output({ project: project.name, log: gitLog(project.path, Number(limit)) });
        break;
      }
      case 'git-diff': {
        const [name] = args;
        requireArg(name, 'git-diff requires a <projectName> argument');
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
