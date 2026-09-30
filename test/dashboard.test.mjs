import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { guard, registerTokenizer } from '../dist/esm/index.js';
import { formatDashboardSummary, readDashboardEvents, startDashboardServer, summarizeDashboard } from '../dist/esm/dashboard.js';
import { daysAgo } from './helpers/dates.mjs';

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

test('dashboard refuses non-loopback binding without explicit opt-in', async () => {
  await assert.rejects(
    () => startDashboardServer({ host: '0.0.0.0', port: 0 }),
    /allowRemote.*authentication/u
  );
});

test('a malformed event log cannot crash the dashboard server', async () => {
  // A JSONL log is a plain file a developer can hand-edit, truncate, or produce with an older
  // release. The renderer calls String methods and toFixed on these fields, so a line whose types do
  // not match the documented shape used to throw inside the request handler. An exception escaping
  // a Node HTTP handler is an uncaughtException that kills the whole process, taking the guarded
  // application down with the dashboard.
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-malformed-'));
  const eventLogPath = join(directory, 'events.jsonl');

  const valid = {
    version: 1,
    timestamp: '2026-06-08T00:00:00.000Z',
    type: 'allow',
    model: 'gpt-4o-mini',
    scopeKey: 'default',
    estimatedCost: 0.001,
    tokens: 100,
  };

  writeFileSync(
    eventLogPath,
    [
      JSON.stringify(valid),
      // Wrong types for every field the renderer dereferences.
      '{ "version":1,"timestamp":"2026-06-08T00:00:00.000Z","type":42,"model":"m","scopeKey":"s","estimatedCost":0.1,"tokens":1 }',
      '{ "version":1,"timestamp":"2026-06-08T00:00:00.000Z","type":"allow","model":42,"scopeKey":"s","estimatedCost":0.1,"tokens":1 }',
      '{ "version":1,"timestamp":"2026-06-08T00:00:00.000Z","type":"allow","model":"m","scopeKey":42,"estimatedCost":0.1,"tokens":1 }',
      '{ "version":1,"timestamp":"2026-06-08T00:00:00.000Z","type":"allow","model":"m","scopeKey":"s","estimatedCost":"0.1","tokens":1 }',
      '{ "version":1,"timestamp":"2026-06-08T00:00:00.000Z","type":"allow","model":"m","scopeKey":"s","estimatedCost":null,"tokens":1 }',
      '{ "version":1,"timestamp":42,"type":"allow","model":"m","scopeKey":"s","estimatedCost":0.1,"tokens":1 }',
      // An unknown event type must be ignored rather than rendered as a table row.
      '{ "version":1,"timestamp":"2026-06-08T00:00:00.000Z","type":"nonsense","model":"m","scopeKey":"s","estimatedCost":0.1,"tokens":1 }',
      // Hostile content must be escaped, not rendered as markup.
      JSON.stringify({ ...valid, model: '<img src=x onerror=alert(1)>', scopeKey: 'a&b"c' }),
    ].join('\n') + '\n',
    'utf8'
  );

  const summary = summarizeDashboard({ eventLogPath });
  assert.equal(summary.recentEvents.length, 2, 'only the two well-formed events are rendered');
  assert.equal(summary.requestsAllowed, 2);

  const { server, url } = await startDashboardServer({ eventLogPath, port: 0 });
  try {
    const html = await fetch(url);
    assert.equal(html.status, 200);
    const body = await html.text();
    assert.match(body, /&lt;img src=x onerror=alert\(1\)&gt;/u, 'model names are HTML-escaped');
    assert.doesNotMatch(body, /<img src=x/u, 'no raw markup from the log reaches the page');

    const json = await fetch(`${url}/events.json`);
    assert.equal(json.status, 200);
    assert.equal((await json.json()).recentEvents.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an unreadable event log path returns an error instead of crashing the server', async () => {
  // readFileSync throws EISDIR/EACCES/EISDIR-style errors for paths that are not readable files.
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-unreadable-'));

  const { server, url } = await startDashboardServer({ eventLogPath: directory, port: 0 });
  try {
    const response = await fetch(url);
    assert.equal(response.status, 500);
    assert.match(await response.text(), /Could not read the event log/u);
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
          lastUpdated: daysAgo(1),
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

test('the JSON summary route matches exactly and ignores the query string', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-route-'));
  const eventLogPath = join(directory, 'events.jsonl');
  writeFileSync(eventLogPath, '', 'utf8');

  const { server, url } = await startDashboardServer({ eventLogPath, port: 0 });

  try {
    const summary = await fetch(`${url}/events.json`);
    assert.equal(summary.status, 200);
    assert.match(summary.headers.get('content-type'), /application\/json/u);

    const queried = await fetch(`${url}/events.json?since=2026-01-01`);
    assert.equal(queried.status, 200);
    assert.match(queried.headers.get('content-type'), /application\/json/u);

    // A prefix match answered these with the raw summary.
    for (const path of ['/events.jsonl', '/events.json.bak', '/events.jsonfoo']) {
      const response = await fetch(`${url}${path}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/u, `${path} must render the dashboard, not the summary`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the dashboard reuses its parse while the log is unchanged and refreshes on append', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-cache-'));
  const eventLogPath = join(directory, 'events.jsonl');
  const record = (cost) =>
    JSON.stringify({
      version: 1,
      timestamp: '2026-06-08T00:00:00.000Z',
      type: 'allow',
      model: 'gpt-4o-mini',
      scopeKey: 'default',
      estimatedCost: cost,
      tokens: 100,
    }) + '\n';

  writeFileSync(eventLogPath, record(0.001), 'utf8');

  const first = summarizeDashboard({ eventLogPath });
  assert.equal(first.requestsAllowed, 1);

  // An append changes the file, so the next poll must see it rather than a cached parse.
  writeFileSync(eventLogPath, record(0.001) + record(0.002), 'utf8');
  const second = summarizeDashboard({ eventLogPath });
  assert.equal(second.requestsAllowed, 2, 'a rewritten log must be re-read');

  // Two summaries of the same unchanged file are equal, and the caller cannot poison the cache.
  const copy = readDashboardEvents(eventLogPath);
  copy.length = 0;
  assert.equal(summarizeDashboard({ eventLogPath }).requestsAllowed, 2, 'a mutated result must not be cached');

  // A different file must not be served from the first file's cache entry.
  const otherLog = join(directory, 'other.jsonl');
  writeFileSync(otherLog, record(0.001) + record(0.002) + record(0.003), 'utf8');
  assert.equal(summarizeDashboard({ eventLogPath: otherLog }).requestsAllowed, 3);
  assert.equal(summarizeDashboard({ eventLogPath }).requestsAllowed, 2, 'switching back re-reads rather than reusing');

  // Polling must not re-parse an unchanged log. This is the whole point of the cache: the dashboard
  // is polled, and re-parsing the file on the request path blocks the guarded application's event
  // loop once the log is large. JSON.parse is the observable here, so the check is not a timing race.
  const lines = [];
  for (let index = 0; index < 500; index += 1) lines.push(record(0.0001));
  const polledLog = join(directory, 'polled.jsonl');
  writeFileSync(polledLog, lines.join(''), 'utf8');

  const originalParse = JSON.parse;
  let parses = 0;
  JSON.parse = (...args) => {
    parses += 1;
    return originalParse(...args);
  };

  try {
    parses = 0;
    summarizeDashboard({ eventLogPath: polledLog });
    assert.equal(parses, 500, 'the first poll parses every record');

    parses = 0;
    for (let poll = 0; poll < 5; poll += 1) summarizeDashboard({ eventLogPath: polledLog });
    assert.equal(parses, 0, 'an unchanged log must not be re-parsed on every poll');

    appendFileSync(polledLog, record(0.0001), 'utf8');
    parses = 0;
    const afterAppend = summarizeDashboard({ eventLogPath: polledLog });
    assert.equal(afterAppend.requestsAllowed, 501, 'an appended record must show up');
    assert.equal(parses, 501, 'an appended log is parsed again');
  } finally {
    JSON.parse = originalParse;
  }
});
