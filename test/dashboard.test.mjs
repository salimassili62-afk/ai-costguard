import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { guard, registerTokenizer } from '../dist/index.js';
import { formatDashboardSummary, startDashboardServer, summarizeDashboard } from '../dist/dashboard.js';

test('dashboard summary ignores malformed lines and aggregates metrics', () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-unit-'));
  const eventLogPath = join(directory, 'events.jsonl');

  writeFileSync(
    eventLogPath,
    [
      'not-json',
      JSON.stringify({
        version: 1,
        timestamp: '2026-06-08T00:00:00.000Z',
        type: 'allow',
        model: 'gpt-4o-mini',
        scopeKey: 'project:demo|user:*|session:*',
        estimatedCost: 0.001,
        actualCost: 0.0008,
        tokens: 100,
      }),
      JSON.stringify({
        version: 1,
        timestamp: '2026-06-08T00:00:01.000Z',
        type: 'block',
        code: 'RETRY_STORM_DETECTED',
        model: 'gpt-4o-mini',
        scopeKey: 'project:demo|user:*|session:*',
        estimatedCost: 0.002,
        tokens: 100,
      }),
    ].join('\n') + '\n',
    'utf8'
  );

  const summary = summarizeDashboard({ eventLogPath, budgetUsd: 0.01 });
  assert.equal(summary.requestsAllowed, 1);
  assert.equal(summary.requestsBlocked, 1);
  assert.equal(summary.retryDetections, 1);
  assert.equal(summary.actualSpendUsd, 0.0008);
  assert.match(formatDashboardSummary(summary), /Budget used/);
});

test('dashboard server exposes local summary JSON', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-server-'));
  const eventLogPath = join(directory, 'events.jsonl');
  writeFileSync(
    eventLogPath,
    JSON.stringify({
      version: 1,
      timestamp: '2026-06-08T00:00:00.000Z',
      type: 'allow',
      model: 'gpt-4o-mini',
      scopeKey: 'default',
      estimatedCost: 0.001,
      tokens: 100,
    }) + '\n',
    'utf8'
  );

  const { server, url } = await startDashboardServer({ eventLogPath, port: 0 });

  try {
    const response = await fetch(`${url}/events.json`);
    const summary = await response.json();
    assert.equal(summary.requestsAllowed, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('dashboard summary includes actual provider usage recorded after allow events', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-actual-'));
  const eventLogPath = join(directory, 'events.jsonl');

  registerTokenizer('actual-dashboard-model', () => 1);

  const guarded = guard(
    {
      chat: {
        completions: {
          create: async () => ({
            ok: true,
            usage: { prompt_tokens: 1000, completion_tokens: 1000 },
          }),
        },
      },
    },
    {
      budget: 1,
      eventLogPath,
      pricingOverrides: [
        {
          model: 'actual-dashboard-model',
          inputPer1kTokens: 0.01,
          outputPer1kTokens: 0.02,
          lastUpdated: '2026-07-03',
          source: 'unit-test',
        },
      ],
    }
  );

  await guarded.chat.completions.create({
    model: 'actual-dashboard-model',
    prompt: 'actual usage dashboard test',
    max_tokens: 1,
  });

  const summary = summarizeDashboard({ eventLogPath, budgetUsd: 1 });
  assert.equal(summary.requestsAllowed, 1);
  assert.equal(summary.requestsBlocked, 0);
  assert.equal(summary.actualSpendUsd, 0.03);
  assert.equal(summary.recentEvents.some((event) => event.type === 'usage' && event.actualCost === 0.03), true);
});
