import { spawnSync } from 'node:child_process';

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

args.push('test/**/*.test.mjs');

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
