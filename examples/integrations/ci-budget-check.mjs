import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// The published CLI lives at dist/esm/cli.js; dist/cjs/cli.js is the CommonJS build of the same file.
const cliPath = join(here, '..', '..', 'dist', 'esm', 'cli.js');

const result = spawnSync(
  process.execPath,
  [
    cliPath,
    'check',
    '--budget',
    '0.25',
    '--model',
    'gpt-4o-mini',
    '--input-tokens',
    '800',
    '--tokens',
    '1200',
    '--max-steps',
    '20',
  ],
  { encoding: 'utf8' }
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exitCode = result.status ?? 1;
} else {
  process.stdout.write(result.stdout);
}
