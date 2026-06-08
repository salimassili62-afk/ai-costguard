import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

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
