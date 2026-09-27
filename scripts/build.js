#!/usr/bin/env node

/**
 * Builds the distributable package: ESM, CommonJS, and one shared set of type declarations.
 *
 * Layout produced under dist/:
 *   dist/esm/**.js   ES modules, loaded through the root "type": "module" package.json
 *   dist/cjs/**.js   CommonJS, marked with dist/cjs/package.json so Node reads it as CJS
 *   dist/types/**.d.ts  single declaration set shared by both condition branches
 *
 * Dual output is what lets the same published tarball serve `import` and `require` consumers
 * without either of them reaching into private paths.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/u, '');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const project of ['tsconfig.esm.json', 'tsconfig.cjs.json', 'tsconfig.types.json']) {
  runTsc(project);
}

// Node resolves the NEAREST package.json to decide the module system of a .js file. Writing an
// explicit marker into each dist subtree makes both halves self-describing, so the dual build cannot
// silently collapse if the root "type" ever changes: dist/cjs is CommonJS and dist/esm is ESM
// regardless of what the root package.json says.
writeFileSync(join(dist, 'cjs', 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`, 'utf8');
writeFileSync(join(dist, 'esm', 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');

// npm sets the executable bit for declared bins, but keeping it here means a locally built dist/
// runs the same way as an installed package.
for (const bin of ['dist/esm/cli.js', 'dist/cjs/cli.js']) {
  try {
    chmodSync(join(root, bin), 0o755);
  } catch {
    // Filesystems without POSIX permissions (for example Windows) do not need this.
  }
}

console.log('[ai-costguard] build complete: dist/esm, dist/cjs, dist/types');

function runTsc(project) {
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [tsc, '--project', project], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`[ai-costguard] build failed: ${project}`);
    process.exit(result.status ?? 1);
  }
}
