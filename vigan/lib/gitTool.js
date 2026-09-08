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
