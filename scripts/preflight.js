#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const checks = [
  ['Build', ['npm', ['run', 'build']]],
  ['Typecheck', ['npm', ['run', 'typecheck']]],
  ['Tests', ['npm', ['test']]],
  ['Smoke checks', ['npm', ['run', 'smoke']]],
  ['Production dependency audit', ['npm', ['audit', '--omit=dev']]],
  ['Package dry run', ['npm', ['pack', '--dry-run']]],
];

let failed = false;

function resolveCommand(command, args) {
  if (command === 'npm' && process.env.npm_execpath) {
    return [process.execPath, [process.env.npm_execpath, ...args]];
  }

  return [command, args];
}

for (const [label, [command, args]] of checks) {
  console.log(`\n[preflight] ${label}`);
  const [executable, executableArgs] = resolveCommand(command, args);
  const result = spawnSync(executable, executableArgs, {
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    failed = true;
    if (result.error) {
      console.error(`[preflight] ${result.error.message}`);
    }
    console.error(`[preflight] failed: ${label}`);
    break;
  }
}

process.exitCode = failed ? 1 : 0;
