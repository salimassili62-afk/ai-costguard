import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const c8Bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'c8', 'bin', 'c8.js');
const args = [
  c8Bin,
  '--check-coverage',
  '--lines=80',
  '--functions=80',
  '--branches=70',
  '--include=dist/**/*.js',
  '--reporter=text',
  process.execPath,
  '--test',
];

const testFiles = findTestFiles('test');
if (testFiles.length === 0) {
  console.error('[ai-costguard] No test files found under test/.');
  process.exit(1);
}

args.push(...testFiles);

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);

function findTestFiles(root) {
  const files = [];
  visit(root);
  return files.sort();

  function visit(path) {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        visit(join(path, entry));
      }
      return;
    }

    if (path.endsWith('.test.mjs')) {
      files.push(path);
    }
  }
}
