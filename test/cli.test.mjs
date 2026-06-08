import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseCheckArgs, parseDashboardArgs, parsePricingArgs, runCli } from '../dist/cli.js';

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

test('CLI executable works through node dist/cli.js', () => {
  const result = spawnSync(
    process.execPath,
    ['dist/cli.js', 'check', '--budget', '1', '--model', 'gpt-4o-mini', '--tokens', '10', '--max-steps', '1'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"ok": true/);
});

test('CLI parses dashboard arguments', () => {
  assert.deepEqual(parseDashboardArgs(['--events', 'events.jsonl', '--budget', '1', '--once', '--json']), {
    eventLogPath: 'events.jsonl',
    budgetUsd: 1,
    host: undefined,
    port: undefined,
    recentLimit: undefined,
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
