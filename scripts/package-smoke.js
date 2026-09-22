import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

  run(npmCommand, [
    ...npmPrefix,
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    join(temporaryDirectory, tarball),
  ], temporaryDirectory);

  writeFileSync(
    join(temporaryDirectory, 'consumer.mjs'),
    `import { guard, GuardError } from '@salimassili/ai-costguard';
let calls = 0;
const client = guard({ chat: { completions: { create: async () => { calls += 1; return {}; } } } }, { budget: 0.000001 });
try {
  await client.chat.completions.create({ model: 'gpt-4', prompt: 'package smoke', max_tokens: 1000 });
  throw new Error('expected package guard to block');
} catch (error) {
  if (!(error instanceof GuardError) || error.code !== 'BUDGET_EXCEEDED' || calls !== 0) throw error;
}
`,
    'utf8'
  );
  run(process.execPath, ['consumer.mjs'], temporaryDirectory);

  const cliPath = join(temporaryDirectory, 'node_modules', '@salimassili', 'ai-costguard', 'dist', 'cli.js');
  const cli = spawnSync(process.execPath, [cliPath, 'check', '--budget', '1', '--model', 'gpt-4o-mini', '--tokens', '10', '--max-steps', '1'], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
  });
  if (cli.status !== 0) throw new Error(cli.stderr || 'packed CLI smoke test failed');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}