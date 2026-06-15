import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const coverageThresholdFlags = [
  '--test-coverage-include',
  '--test-coverage-lines',
  '--test-coverage-functions',
  '--test-coverage-branches',
];
const supportsCoverageThresholdFlags = coverageThresholdFlags.every((flag) =>
  process.allowedNodeEnvironmentFlags.has(flag)
);

const args = ['--test'];

if (supportsCoverageThresholdFlags) {
  args.push(
    '--experimental-test-coverage',
    '--test-coverage-include=dist/**/*.js',
    '--test-coverage-lines=80',
    '--test-coverage-functions=80',
    '--test-coverage-branches=70'
  );
} else {
  args.push('--experimental-test-coverage');
  console.warn(
    `[ai-costguard] Node ${process.versions.node} does not support test coverage threshold flags; ` +
      'running tests with Node 18-compatible coverage output.'
  );
}

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
