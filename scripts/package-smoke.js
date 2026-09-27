#!/usr/bin/env node

/**
 * Installs the packed tarball into a throwaway directory and exercises it the way a real consumer
 * would.
 *
 * This is the only check that validates the published artifact rather than the working tree, and it
 * is the only check that can catch an export map, a `files` allowlist, or a `bin` path that works
 * locally and breaks once npm has repackaged everything. It therefore asserts four separate
 * contracts: ESM import, CommonJS require, both bins, and that the free product arrives complete.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'ai-costguard-package-'));

try {
  const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];

  run(npmCommand, [...npmPrefix, 'pack', '--pack-destination', temporaryDirectory, '--ignore-scripts']);
  const tarball = readdirSync(temporaryDirectory).find((entry) => entry.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack did not produce a tarball');

  run(
    npmCommand,
    [
      ...npmPrefix,
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      join(temporaryDirectory, tarball),
    ],
    temporaryDirectory
  );

  const installed = join(temporaryDirectory, 'node_modules', '@salimassili', 'ai-costguard');

  // --- the tarball must contain both module formats and the shared type declarations ---------------
  for (const file of [
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
    'README.md',
    'LICENSE',
    'docs/ACCOUNTING.md',
    'docs/COVERAGE.md',
    'docs/SHARED-BUDGET.md',
  ]) {
    if (!existsSync(join(installed, file))) {
      throw new Error(`packed tarball is missing ${file}. Check the "files" allowlist in package.json.`);
    }
  }

  const installedPackageJson = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  if (installedPackageJson.dependencies && Object.keys(installedPackageJson.dependencies).length > 0) {
    throw new Error(`the free package must install with no dependencies, found ${JSON.stringify(installedPackageJson.dependencies)}`);
  }
  if (installedPackageJson.peerDependenciesMeta?.ioredis?.optional !== true) {
    throw new Error('ioredis must be an optional peer dependency');
  }

  // Nothing resembling a payment or license gate may ship.
  for (const file of ['dist/esm/index.js', 'dist/esm/pro.js', 'dist/cjs/index.js', 'dist/cjs/pro.js', 'README.md']) {
    const content = readFileSync(join(installed, file), 'utf8');
    if (/lemonsqueezy|gumroad|stripe|license[-_]?key|activation code/iu.test(content)) {
      throw new Error(`packed artifact references a payment or license gate: ${file}`);
    }
  }

  // --- ESM: import the public entry point and the /pro subpath --------------------------------------
  writeFileSync(
    join(temporaryDirectory, 'consumer.mjs'),
    `import { guard, GuardError, DEFAULT_GUARDED_METHODS } from '@salimassili/ai-costguard';
import { GuardPro } from '@salimassili/ai-costguard/pro';
import { getPricing } from '@salimassili/ai-costguard/pricing';

if (typeof guard !== 'function') throw new Error('guard is not a function');
if (typeof GuardPro !== 'function') throw new Error('GuardPro is not a function');
if (getPricing('gpt-4o-mini') === undefined) throw new Error('pricing subpath returned nothing');
if (!Array.isArray(DEFAULT_GUARDED_METHODS)) throw new Error('DEFAULT_GUARDED_METHODS missing');

let calls = 0;
const client = guard({ chat: { completions: { create: async () => { calls += 1; return {}; } } } }, { budget: 0.000001 });
try {
  await client.chat.completions.create({ model: 'gpt-4', prompt: 'package smoke', max_tokens: 1000 });
  throw new Error('expected package guard to block');
} catch (error) {
  if (!(error instanceof GuardError) || error.code !== 'BUDGET_EXCEEDED' || calls !== 0) throw error;
}

console.log('esm ok');
`,
    'utf8'
  );
  run(process.execPath, ['consumer.mjs'], temporaryDirectory);

  // --- CommonJS: require() must resolve the "require" condition, not throw ERR_REQUIRE_ESM ----------
  writeFileSync(
    join(temporaryDirectory, 'consumer.cjs'),
    `const { guard, GuardError, createGuardState } = require('@salimassili/ai-costguard');
const { GuardPro } = require('@salimassili/ai-costguard/pro');

if (typeof guard !== 'function') throw new Error('guard is not a function');
if (typeof GuardPro !== 'function') throw new Error('GuardPro is not a function');
if (typeof createGuardState !== 'function') throw new Error('createGuardState is not a function');

let calls = 0;
const client = guard({ chat: { completions: { create: async () => { calls += 1; return {}; } } } }, { budget: 0.000001 });
try {
  client.chat.completions.create({ model: 'gpt-4', prompt: 'package smoke', max_tokens: 1000 });
  throw new Error('expected package guard to block');
} catch (error) {
  if (!(error instanceof GuardError) || error.code !== 'BUDGET_EXCEEDED' || calls !== 0) throw error;
}

console.log('cjs ok');
`,
    'utf8'
  );
  run(process.execPath, ['consumer.cjs'], temporaryDirectory);

  // --- both bin aliases must be executable and must agree on exit codes -----------------------------
  for (const bin of ['aifw', 'ai-costguard']) {
    const binPath = join(temporaryDirectory, 'node_modules', '.bin', bin);
    if (!existsSync(binPath)) {
      throw new Error(`bin "${bin}" was not linked into node_modules/.bin`);
    }

    const allowed = spawnSync(process.execPath, [join(installed, 'dist/esm/cli.js'), 'check', '--budget', '1', '--model', 'gpt-4o-mini', '--tokens', '10', '--max-steps', '1'], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
    });
    if (allowed.status !== 0) throw new Error(`packed ESM CLI check failed: ${allowed.stderr || allowed.stdout}`);

    const blocked = spawnSync(process.execPath, [join(installed, 'dist/cjs/cli.js'), 'check', '--budget', '0.000001', '--model', 'gpt-4o-mini', '--tokens', '100000', '--max-steps', '100000'], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
    });
    if (blocked.status !== 1) {
      throw new Error(`packed CJS CLI should exit 1 when over budget, received ${blocked.status}: ${blocked.stderr || blocked.stdout}`);
    }
  }

  console.log('[ai-costguard] package smoke passed: esm, cjs, both bins, free-product integrity');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}
