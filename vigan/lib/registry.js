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
