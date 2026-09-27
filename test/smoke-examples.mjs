import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Repository hygiene, asserted rather than eyeballed.
 *
 * Two failure modes are being guarded against here:
 *
 * 1. A paid-tier or license-gate reference creeping back into the free product.
 * 2. Documentation that has drifted from the code it describes, which is how a repo slowly starts
 *    lying to its own users.
 */

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

// --- The free product must stay free and self-contained -----------------------------------------

assert.ok(packageJson.exports['.'], 'root export missing');
assert.ok(packageJson.exports['./pro'], 'pro subpath export missing');
assert.ok(packageJson.exports['./pricing'], 'pricing subpath export missing');
assert.ok(packageJson.exports['./package.json'], 'package.json export missing');
assert.equal(packageJson.dependencies, undefined, 'the free package must have no runtime dependencies');
// ioredis is declared, but as an OPTIONAL peer: npm does not install it, so a plain
// `npm install @salimassili/ai-costguard` stays dependency-free, while the requirement of the
// /pro subpath is still visible in the manifest instead of only in a doc.
assert.ok(packageJson.peerDependencies?.ioredis, 'ioredis must be declared for the /pro subpath');
assert.equal(
  packageJson.peerDependenciesMeta?.ioredis?.optional,
  true,
  'ioredis must be an optional peer so a plain install stays lean'
);
assert.equal(packageJson.license, 'MIT');
assert.equal(packageJson.private, undefined, 'a publishable package must not be marked private');

const root = await import('../dist/esm/index.js');
assert.equal(typeof root.guard, 'function');
assert.equal(typeof root.guardFunction, 'function');
assert.equal(typeof root.middleware, 'function');
assert.equal(typeof root.GuardError, 'function');
assert.equal(typeof root.createGuardState, 'function');
assert.equal(typeof root.registerPricing, 'function');
assert.equal(typeof root.getPricing, 'function');
assert.equal(typeof root.isBuiltInPricingStale, 'function');
assert.equal(Array.isArray(root.DEFAULT_GUARDED_METHODS), true);

const pro = await import('../dist/esm/pro.js');
assert.equal(typeof pro.GuardPro, 'function');

// Nothing license-, activation-, or telemetry-shaped may be reachable from the shipped entry points.
for (const [label, namespace] of [['index', root], ['pro', pro]]) {
  for (const key of Object.keys(namespace)) {
    assert.doesNotMatch(
      key,
      /licen[cs]e|activat|serial|regist(?:er|ration)Key|telemetry|analytics|phone.?home/iu,
      `${label} exports a license/telemetry-shaped symbol: ${key}`
    );
  }
}

for (const file of ['dist/esm/index.js', 'dist/esm/pro.js', 'dist/cjs/index.js', 'dist/cjs/pro.js']) {
  const content = readFileSync(file, 'utf8');
  assert.doesNotMatch(content, /require\(['"]https?:/u, `${file} performs a network require`);
  assert.doesNotMatch(content, /license[-_ ]?key|activation|lemonsqueezy|gumroad|stripe/iu, `${file} references a payment or license gate`);
}

// --- Repository layout ----------------------------------------------------------------------------

// The stale-copy sweep below only reads a fixed list of directories, so a NEW top-level folder full of
// paid-kit material would sail past every assertion above. Two real directories (`_archive/` and
// `marketing/`) survived in the repository for exactly that reason, one of them still advertising a
// $199 purchase. Allowlist the repository root instead: a new top-level directory has to be a
// deliberate, reviewed decision.
const ALLOWED_ROOT_DIRECTORIES = new Set([
  '.git',
  '.github',
  '.ai-costguard', // local event log written by the guard; gitignored
  'benchmarks',
  'coverage', // c8 output; gitignored
  'dist', // build output; gitignored
  'docs',
  'examples',
  'landing',
  'node_modules',
  'scripts',
  'src',
  'templates',
  'test',
]);

for (const entry of readdirSync('.', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  assert.ok(
    ALLOWED_ROOT_DIRECTORIES.has(entry.name),
    `unexpected top-level directory ${entry.name}/; add it to ALLOWED_ROOT_DIRECTORIES only if it belongs in the free repository`,
  );
}

for (const removed of [
  'pro-v0.1',
  '_archive',
  'marketing',
  'costguard-demo',
  'aifw.example.js',
  'src/core/CostGuard.ts',
  'docs/PRO.md',
  'docs/PRO_FEATURES.md',
]) {
  assert.equal(existsSync(removed), false, `${removed} was removed and must not come back`);
}

// The build must emit both module formats, and each needs its own package.json type marker.
for (const file of [
  'dist/esm/index.js',
  'dist/esm/pro.js',
  'dist/esm/cli.js',
  'dist/cjs/index.js',
  'dist/cjs/pro.js',
  'dist/cjs/cli.js',
  'dist/types/index.d.ts',
  'dist/cjs/package.json',
]) {
  assert.ok(existsSync(file), `build output missing: ${file}`);
}
assert.equal(JSON.parse(readFileSync('dist/cjs/package.json', 'utf8')).type, 'commonjs');
assert.equal(JSON.parse(readFileSync('dist/esm/package.json', 'utf8')).type, 'module');

// Both bins must point at a file that exists.
for (const [name, target] of Object.entries(packageJson.bin)) {
  assert.ok(existsSync(target), `bin "${name}" points at a missing file: ${target}`);
}

// --- The tarball must actually contain the build output ------------------------------------------
//
// The `files` allowlist is the only thing that decides what ships, and nothing asserts that it
// actually produced a usable artifact. A `files` entry that stops matching, a rename in the build
// script, or a stray ignore rule would all yield a tarball with no code in it while the package still
// builds, tests, and typechecks perfectly in the working tree. Read the real packed file list.
//
// Note: run this only when no build is in flight. `scripts/build.js` deletes and recreates dist/, so
// packing concurrently with `npm test` observes a half-written dist and reports it as missing.
const packed = JSON.parse(execFileSync(process.execPath, [...resolveNpmCli(), 'pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }))[0];

const packedFiles = new Set(packed.files.map((entry) => entry.path));
for (const required of [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'dist/esm/index.js',
  'dist/esm/pro.js',
  'dist/esm/cli.js',
  'dist/esm/package.json',
  'dist/cjs/index.js',
  'dist/cjs/pro.js',
  'dist/cjs/cli.js',
  'dist/cjs/package.json',
  'dist/types/index.d.ts',
  'dist/types/pro.d.ts',
  'docs/ACCOUNTING.md',
  'docs/COVERAGE.md',
  'docs/SHARED-BUDGET.md',
]) {
  assert.ok(packedFiles.has(required), `npm pack --dry-run is missing ${required}; the published tarball would be broken`);
}

// Nothing ungenerated, secret-shaped, or local-only may ship.
for (const path of packedFiles) {
  assert.doesNotMatch(path, /(?:^|\/)node_modules\//u, `packaged a node_modules path: ${path}`);
  assert.doesNotMatch(path, /(?:^|\/)\.env(?:\.|$)/u, `packaged an environment file: ${path}`);
  assert.doesNotMatch(path, /\.test-home|\.tgz$|coverage\//u, `packaged local test residue: ${path}`);
  assert.doesNotMatch(path, /^src\/|^test\/|^scripts\//u, `packaged source-internal paths: ${path}`);
}

// --- Documentation must exist and must not advertise a paid tier --------------------------------

for (const doc of [
  'docs/ACCOUNTING.md',
  'docs/COVERAGE.md',
  'docs/SHARED-BUDGET.md',
  'docs/INTEGRATIONS.md',
  'docs/DASHBOARD.md',
  'docs/BENCHMARKS.md',
  'START-HERE.md',
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'ARCHITECTURE.md',
  'CHANGELOG.md',
]) {
  assert.ok(existsSync(doc), `documented file is missing: ${doc}`);
}

// Every docs/ link in the README must resolve to a file that exists.
const readme = readFileSync('README.md', 'utf8');
for (const match of readme.matchAll(/\]\((?:\.\/)?(docs\/[A-Za-z-]+\.md|START-HERE\.md|[A-Z]+\.md|LICENSE)\)/gu)) {
  assert.ok(existsSync(match[1]), `README links to a missing file: ${match[1]}`);
}

// Every docs/ link in the source must resolve too: a code comment pointing nowhere is a real defect.
for (const file of walkFiles(['src'])) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(/docs\/[A-Za-z-]+\.md/gu)) {
    assert.ok(existsSync(match[0]), `${file} references a missing document: ${match[0]}`);
  }
}

// --- Stale-copy sweep -----------------------------------------------------------------------------

for (const file of walkFiles(['examples', 'templates', 'landing', 'docs', 'README.md', 'START-HERE.md'])) {
  const content = readFileSync(file, 'utf8');
  assert.doesNotMatch(content, /\.\.\/src/u, `${file} imports private src`);
  assert.doesNotMatch(content, /firewall_blocked/u, `${file} uses stale error shape`);
  assert.doesNotMatch(content, /aifw budget|npx aifw init/u, `${file} advertises a nonexistent CLI command`);
  assert.doesNotMatch(content, /express-firewall|nextjs-firewall|ai-firewall/u, `${file} uses stale firewall naming`);
  assert.doesNotMatch(content, /\$29\/month|\$29\/mo|Pro-\$29/u, `${file} uses stale Pro pricing`);
  assert.doesNotMatch(content, /lemonsqueezy|gumroad/iu, `${file} advertises a purchase link`);
  assert.doesNotMatch(content, /Production Kit/iu, `${file} advertises a paid product`);
  assert.doesNotMatch(content, /docs\/PRO\.md|PRO_FEATURES\.md/u, `${file} links to a removed document`);
  assert.doesNotMatch(content, /pro-v0\.1|\bmarketing\//u, `${file} references a removed directory`);
}

// --- Encoding integrity ---------------------------------------------------------------------------

// UTF-8 that was decoded as Latin-1 (the classic double-encode) leaves two traces: C1 control
// characters, because continuation bytes land in U+0080..U+009F, and a Latin-1 letter glued to a
// Euro sign, which is how a curly quote renders (`â€™`). This is not cosmetic. A double-encoded
// corpus sample has more characters than the real text, so a token-accuracy benchmark built on it
// measures the corruption instead of the estimator: the Arabic sample scores 0% error, and scored
// 116.67% while it was double-encoded. Benchmarks and docs carry non-ASCII on purpose, so check them.
for (const file of walkFiles(['benchmarks', 'docs', 'examples', 'landing', 'README.md', 'START-HERE.md'])) {
  const content = readFileSync(file, 'utf8');
  assert.doesNotMatch(
    content,
    /[\u0080-\u009f]/u,
    `${file} contains C1 control characters, so some text is double-encoded UTF-8`,
  );
  assert.doesNotMatch(
    content,
    /[\u00c0-\u00ff]\u20ac/u,
    `${file} contains a double-encoded smart quote`,
  );
}

for (const file of ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md', 'START-HERE.md']) {
  const content = readFileSync(file, 'utf8');
  assert.doesNotMatch(content, /AI Execution Firewall/u, `${file} uses stale product name`);
  // Target the call to action, not the words. A document is allowed to say "there is no paid tier";
  // what must not come back is an instruction to go and buy something.
  assert.doesNotMatch(
    content,
    /\b(?:buy|purchase|upgrade to|subscribe to|get) (?:the )?(?:pro|production kit|premium|pro tier)\b/iu,
    `${file} contains a purchase call to action`
  );
  assert.doesNotMatch(content, /\$\d+\s*(?:\/|per\s*)?(?:mo|month|year|one[- ]time)/iu, `${file} quotes a price`);
}

/**
 * Locates npm's JavaScript entry point so it can be run as `node <npm-cli.js> ...`.
 *
 * Going through the JS entry point rather than the `npm`/`npm.cmd` shim is deliberate: `.cmd` files
 * cannot be spawned without a shell on current Node, and `shell: true` with an argument list is a
 * command-injection footgun. This works the same whether the file is run directly or via `npm run`.
 */
function resolveNpmCli() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return [process.env.npm_execpath];
  }

  // <node>/npm-cli.js or <node>/node_modules/npm/bin/npm-cli.js
  for (const relative of ['npm-cli.js', join('node_modules', 'npm', 'bin', 'npm-cli.js')]) {
    const candidate = join(dirname(process.execPath), relative);
    if (existsSync(candidate)) return [candidate];
  }

  throw new Error('could not locate npm-cli.js; cannot verify the packed file list');
}

function walkFiles(roots) {
  const wantedExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.md', '.json']);
  const files = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    visit(root);
  }

  return files;

  function visit(path) {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (path.includes('node_modules') || path.includes('.next')) return;
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
