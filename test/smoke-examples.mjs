import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
assert.ok(packageJson.exports['.']);
assert.ok(packageJson.exports['./pro']);
assert.ok(packageJson.exports['./pricing']);
assert.equal(packageJson.dependencies, undefined);
assert.ok(packageJson.optionalDependencies.ioredis);

const root = await import('../dist/index.js');
assert.equal(typeof root.guard, 'function');
assert.equal(typeof root.guardFunction, 'function');
assert.equal(typeof root.GuardError, 'function');
assert.equal(root.GuardPro, undefined);

const pro = await import('../dist/pro.js');
assert.equal(typeof pro.GuardPro, 'function');

for (const file of walkFiles(['examples', 'templates', 'landing', 'docs'])) {
  const content = readFileSync(file, 'utf8');
  assert.doesNotMatch(content, /\.\.\/src/u, `${file} imports private src`);
  assert.doesNotMatch(content, /firewall_blocked/u, `${file} uses stale error shape`);
  assert.doesNotMatch(content, /aifw budget|npx aifw init/u, `${file} advertises nonexistent CLI command`);
}

for (const file of ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md']) {
  const content = readFileSync(file, 'utf8');
  assert.doesNotMatch(content, /AI Execution Firewall/u, `${file} uses stale product name`);
}

function walkFiles(roots) {
  const wantedExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.md', '.json']);
  const files = [];

  for (const root of roots) {
    visit(root);
  }

  return files;

  function visit(path) {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (path.includes('node_modules') || path.includes('.next')) return;
      if (path.includes(join('docs', 'archive'))) return;
      for (const entry of readdirSync(path)) {
        visit(join(path, entry));
      }
      return;
    }

    const extension = path.slice(path.lastIndexOf('.'));
    if (wantedExtensions.has(extension)) {
      files.push(path);
    }
  }
}
