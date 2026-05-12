const path = require('node:path');

const groupByWorkspace = (files) => {
  const root = process.cwd();
  const groups = new Map();
  for (const file of files) {
    const rel = path.relative(root, file);
    const m = rel.match(/^((?:apps|packages)\/[^/]+)\//);
    if (!m) continue;
    const ws = m[1];
    const wsRel = path.relative(ws, rel);
    if (!groups.has(ws)) groups.set(ws, []);
    groups.get(ws).push(wsRel);
  }
  return groups;
};

const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

module.exports = {
  '*.{ts,tsx}': (files) => {
    const cmds = [];
    for (const [ws, relFiles] of groupByWorkspace(files)) {
      const args = relFiles.map(shellQuote).join(' ');
      cmds.push(`bash -c "cd ${shellQuote(ws)} && npx --no-install eslint --fix --max-warnings 0 ${args}"`);
    }
    cmds.push(`prettier --write ${files.map(shellQuote).join(' ')}`);
    return cmds;
  },
  '*.{json,md}': (files) => `prettier --write ${files.map(shellQuote).join(' ')}`,
};
