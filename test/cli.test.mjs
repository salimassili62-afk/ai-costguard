import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseCheckArgs, parseDashboardArgs, parsePricingArgs, runCli } from '../dist/esm/cli.js';

test('CLI parses check arguments', () => {
  assert.deepEqual(
    parseCheckArgs(['--budget', '1', '--model', 'gpt-4o-mini', '--tokens', '1000', '--max-steps', '3']),
    {
      budget: 1,
      model: 'gpt-4o-mini',
      tokens: 1000,
      inputTokens: 0,
      maxSteps: 3,
      inputPricePer1k: undefined,
      outputPricePer1k: undefined,
    }
  );
});

test('CLI check returns zero when projected cost is within budget', () => {
  let stdout = '';
  const code = runCli(['check', '--budget', '1', '--model', 'gpt-4o-mini', '--tokens', '1000', '--max-steps', '2'], {
    stdout: (message) => {
      stdout += message;
    },
    stderr: () => undefined,
  });

  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).ok, true);
});

test('CLI check compares the rounded figure it reports, not the raw float', () => {
  // 3 steps of $0.10 is exactly $0.30, but 0.1 * 3 is 0.30000000000000004 in IEEE-754. The gate used
  // to fail that request with exit 1 while printing "estimatedCostUsd": 0.3, so the JSON and the
  // exit code contradicted each other. The library rounds at micro-cent scale everywhere else; the
  // CLI has to compare on the same scale it reports.
  let stdout = '';
  const code = runCli(
    [
      'check',
      '--budget',
      '0.3',
      '--model',
      'gpt-4o-mini',
      '--input-tokens',
      '0',
      '--tokens',
      '1000',
      '--max-steps',
      '3',
      '--input-price-per-1k',
      '0',
      '--output-price-per-1k',
      '0.1',
    ],
    {
      stdout: (message) => {
        stdout += message;
      },
      stderr: () => undefined,
    }
  );

  const result = JSON.parse(stdout);
  assert.equal(result.estimatedCostUsd, 0.3);
  assert.equal(result.budgetUsd, 0.3);
  assert.equal(result.ok, true, 'a cost that lands exactly on the budget is within budget');
  assert.equal(code, 0, 'the exit code must agree with the reported figure');

  // One step more is genuinely over budget and must still fail.
  let overStdout = '';
  const overCode = runCli(
    [
      'check',
      '--budget',
      '0.3',
      '--model',
      'gpt-4o-mini',
      '--input-tokens',
      '0',
      '--tokens',
      '1000',
      '--max-steps',
      '4',
      '--input-price-per-1k',
      '0',
      '--output-price-per-1k',
      '0.1',
    ],
    {
      stdout: (message) => {
        overStdout += message;
      },
      stderr: () => undefined,
    }
  );
  assert.equal(JSON.parse(overStdout).ok, false);
  assert.equal(overCode, 1);
});

test('CLI check discloses which pricing entry the cost came from', () => {
  // A CI budget gate that silently prices an unknown model from a family prefix is gating on an
  // assumed number, so the report says which entry was used and whether it matched exactly.
  const run = (model) => {
    let stdout = '';
    runCli(['check', '--budget', '100', '--model', model, '--tokens', '1000', '--max-steps', '1'], {
      stdout: (message) => {
        stdout += message;
      },
      stderr: () => undefined,
    });
    return JSON.parse(stdout);
  };

  const exact = run('gpt-4.1');
  assert.equal(exact.pricingModel, 'gpt-4.1');
  assert.equal(exact.pricingMatch, 'exact');
  assert.equal(exact.pricingOrigin, 'builtin');

  const guessed = run('gpt-4.1-turbo');
  assert.equal(guessed.model, 'gpt-4.1-turbo');
  assert.equal(guessed.pricingModel, 'gpt-4.1', 'the entry actually used is reported');
  assert.equal(guessed.pricingMatch, 'family-prefix');
  assert.notEqual(guessed.pricingModel, guessed.model);
});

test('CLI distinguishes a missing required flag from a malformed one', () => {
  // Number(undefined) is NaN, so the two mistakes used to produce the same "must be a non-negative
  // number" message, which told someone who forgot --budget that their budget was negative.
  const run = (args) => {
    let stderr = '';
    const code = runCli(args, { stdout: () => undefined, stderr: (message) => (stderr += message) });
    return { code, firstLine: stderr.split('\n')[0] };
  };

  for (const flag of ['budget', 'model', 'tokens']) {
    const args = ['check', '--budget', '1', '--model', 'gpt-4o-mini', '--tokens', '100'];
    const index = args.indexOf(`--${flag}`);
    args.splice(index, 2);
    const missing = run(args);
    assert.equal(missing.code, 2);
    assert.equal(missing.firstLine, `--${flag} is required`);
  }

  assert.equal(run(['check', '--budget', 'abc', '--model', 'gpt-4o-mini', '--tokens', '1']).firstLine,
    '--budget must be a non-negative number, received "abc"');
  assert.equal(run(['check', '--budget', '-1', '--model', 'gpt-4o-mini', '--tokens', '1']).firstLine,
    '--budget must be a non-negative number, received "-1"');
  // An optional flag that is present but malformed is still reported as malformed, not missing.
  assert.equal(
    run(['check', '--budget', '1', '--model', 'gpt-4o-mini', '--tokens', '1', '--input-tokens', 'x']).firstLine,
    '--input-tokens must be a non-negative number, received "x"'
  );
});

test('CLI check supports custom model pricing', () => {
  let stdout = '';
  const code = runCli(
    [
      'check',
      '--budget',
      '1',
      '--model',
      'private-model',
      '--input-tokens',
      '100',
      '--tokens',
      '200',
      '--max-steps',
      '2',
      '--input-price-per-1k',
      '0.001',
      '--output-price-per-1k',
      '0.002',
    ],
    {
      stdout: (message) => {
        stdout += message;
      },
      stderr: () => undefined,
    }
  );

  const result = JSON.parse(stdout);
  assert.equal(code, 0);
  assert.equal(result.model, 'private-model');
  assert.equal(result.inputTokensPerStep, 100);
  assert.equal(result.outputTokensPerStep, 200);
});

test('CLI check rejects unknown models without custom pricing', () => {
  let stderr = '';
  const code = runCli(['check', '--budget', '1', '--model', 'private-model', '--tokens', '100'], {
    stdout: () => undefined,
    stderr: (message) => {
      stderr += message;
    },
  });

  assert.equal(code, 2);
  assert.match(stderr, /No pricing found/);
});

test('CLI check returns one when projected cost exceeds budget', () => {
  const code = runCli(['check', '--budget', '0.01', '--model', 'gpt-4', '--tokens', '1000', '--max-steps', '1'], {
    stdout: () => undefined,
    stderr: () => undefined,
  });

  assert.equal(code, 1);
});

test('CLI executable runs from both the ESM and the CommonJS build', () => {
  for (const entry of ['dist/esm/cli.js', 'dist/cjs/cli.js']) {
    const result = spawnSync(
      process.execPath,
      [entry, 'check', '--budget', '1', '--model', 'gpt-4o-mini', '--tokens', '10', '--max-steps', '1'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, `${entry} exited ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /"ok": true/, `${entry} did not print a passing projection`);
  }
});

test('CLI parses dashboard arguments', () => {
  assert.deepEqual(parseDashboardArgs(['--events', 'events.jsonl', '--budget', '1', '--once', '--json']), {
    eventLogPath: 'events.jsonl',
    budgetUsd: 1,
    host: undefined,
    port: undefined,
    recentLimit: undefined,
    allowRemote: false,
    once: true,
    json: true,
  });
});

test('CLI dashboard summarizes local JSONL events without starting a server', () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-'));
  const eventLogPath = join(directory, 'events.jsonl');
  writeFileSync(
    eventLogPath,
    [
      JSON.stringify({
        version: 1,
        timestamp: '2026-06-08T00:00:00.000Z',
        type: 'allow',
        model: 'gpt-4o-mini',
        scopeKey: 'default',
        estimatedCost: 0.001,
        tokens: 100,
      }),
      JSON.stringify({
        version: 1,
        timestamp: '2026-06-08T00:00:01.000Z',
        type: 'block',
        code: 'LOOP_DETECTED',
        model: 'gpt-4o-mini',
        scopeKey: 'default',
        estimatedCost: 0.002,
        tokens: 100,
      }),
    ].join('\n') + '\n',
    'utf8'
  );

  let stdout = '';
  const code = runCli(['dashboard', '--events', eventLogPath, '--budget', '0.01', '--once', '--json'], {
    stdout: (message) => {
      stdout += message;
    },
    stderr: () => undefined,
  });

  const summary = JSON.parse(stdout);
  assert.equal(code, 0);
  assert.equal(summary.requestsAllowed, 1);
  assert.equal(summary.requestsBlocked, 1);
  assert.equal(summary.loopDetections, 1);
  assert.equal(summary.estimatedSavingsUsd, 0.002);
});

test('CLI parses pricing freshness arguments', () => {
  assert.deepEqual(parsePricingArgs(['--check-stale', '--days', '90']), {
    checkStale: true,
    days: 90,
  });
});

test('CLI pricing freshness check emits registry metadata', () => {
  let stdout = '';
  const code = runCli(['pricing', '--check-stale', '--days', '9999'], {
    stdout: (message) => {
      stdout += message;
    },
    stderr: () => undefined,
  });

  const result = JSON.parse(stdout);
  assert.equal(code, 0);
  assert.equal(result.ok, true);
  assert.equal(result.thresholdDays, 9999);
  assert.ok(result.entries.some((entry) => entry.model === 'gpt-4o-mini'));
});
