const path = require('node:path');

function isPathAllowed(targetPath, allowedRoot) {
  const resolvedRoot = path.resolve(allowedRoot);
  const resolvedTarget = path.resolve(allowedRoot, targetPath);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(rootWithSep);
}

module.exports = { isPathAllowed };
