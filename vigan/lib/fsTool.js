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
  let resolvedRoot;
  let resolvedTarget;
  try {
    resolvedRoot = fs.realpathSync(root);
    resolvedTarget = fs.realpathSync(target);
  } catch {
    throw new Error(`Path "${subpath}" does not exist`);
  }
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
