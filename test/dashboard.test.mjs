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
  await assert.rejects(() => startDashboardServer({ host: '0.0.0.0', port: 0 }), /allowRemote/u);
});

test('dashboard refuses non-loopback binding without an auth token', async () => {
  await assert.rejects(
    () => startDashboardServer({ host: '0.0.0.0', port: 0, allowRemote: true }),
    /authentication/u
  );
});

test('dashboard refuses a non-loopback binding with a too-short auth token', async () => {
  await assert.rejects(
    () => startDashboardServer({ host: '0.0.0.0', port: 0, allowRemote: true, authToken: 'short' }),
    /at least 16 characters/u
  );
});

test('dashboard accepts a token of exactly the minimum length', async () => {
  const { server } = await startDashboardServer({ port: 0, authToken: 'a'.repeat(16) });
  try {
    assert.ok(server.listening);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('dashboard requires the token on every request and every method once one is set', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-auth-'));
  const eventLogPath = join(directory, 'events.jsonl');
  writeFileSync(eventLogPath, '', 'utf8');

  const token = 'unit-test-dashboard-token-0123456789';
  const { server, url } = await startDashboardServer({ eventLogPath, port: 0, authToken: token });

  try {
    // A browser navigation to the root is redirected to the login form, never handed a 401.
    const root = await fetch(url, { redirect: 'manual' });
    assert.equal(root.status, 303, 'an unauthenticated navigation is redirected, not rejected');
    assert.equal(root.headers.get('location'), '/login');

    // Everything else, on any method, gets a plain 401 for programmatic callers.
    const anonymousJson = await fetch(`${url}/events.json`);
    assert.equal(anonymousJson.status, 401, 'the JSON route is gated');

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await fetch(url, { method });
      assert.equal(response.status, 401, `${method} / must be gated`);
    }

    // A token in the query string must NOT authenticate: it would leak through history, logs, and
    // the Referer header.
    const viaQuery = await fetch(`${url}/events.json?token=${encodeURIComponent(token)}`);
    assert.equal(viaQuery.status, 401, 'a token in the URL is ignored');
    assert.equal(viaQuery.headers.get('set-cookie'), null, 'no cookie is issued for a URL token');

    const wrong = await fetch(`${url}/events.json`, { headers: { authorization: 'Bearer a-different-token-000000000000' } });
    assert.equal(wrong.status, 401, 'a wrong token is rejected');

    const bearer = await fetch(`${url}/events.json`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(bearer.status, 200);
    assert.match(bearer.headers.get('cache-control') ?? '', /no-store/u, 'authenticated responses are not cached');
    assert.equal(bearer.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(bearer.headers.get('x-content-type-options'), 'nosniff');

    const headerToken = await fetch(`${url}/events.json`, { headers: { 'x-costguard-token': token } });
    assert.equal(headerToken.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('dashboard login exchanges a POSTed token for an HttpOnly cookie and never uses a URL', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-login-'));
  const eventLogPath = join(directory, 'events.jsonl');
  writeFileSync(eventLogPath, '', 'utf8');

  const token = 'login-flow-dashboard-token-0123456789';
  const { server, url } = await startDashboardServer({ eventLogPath, port: 0, authToken: token });

  try {
    // The login form is public, posts to /login, and never renders the token.
    const form = await fetch(`${url}/login`);
    assert.equal(form.status, 200);
    const html = await form.text();
    assert.match(html, /<form method="post" action="\/login">/u);
    assert.match(html, /type="password"/u);
    assert.doesNotMatch(html, new RegExp(token, 'u'), 'the token is never rendered into the page');

    // A non-GET/HEAD/POST method on the login endpoint is a 405, not a token check.
    assert.equal((await fetch(`${url}/login`, { method: 'PUT' })).status, 405);

    // A wrong token re-renders the form with 401, sets no cookie, and never echoes the secret.
    const submitted = 'wrong-token-value-0000000000';
    const bad = await fetch(`${url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: submitted }).toString(),
      redirect: 'manual',
    });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers.get('set-cookie'), null);
    assert.doesNotMatch(await bad.text(), new RegExp(submitted, 'u'), 'the submitted secret is not echoed');

    // The correct token sets an HttpOnly, SameSite cookie and redirects to a fixed target.
    const good = await fetch(`${url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      redirect: 'manual',
    });
    assert.equal(good.status, 303);
    assert.equal(good.headers.get('location'), '/', 'the redirect target is fixed, not attacker-controlled');
    const setCookie = good.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /costguard_dashboard_token=/u);
    assert.match(setCookie, /HttpOnly/u);
    assert.match(setCookie, /SameSite=Strict/u);
    assert.doesNotMatch(setCookie, /;\s*Secure/u, 'the cookie is not marked Secure on plain HTTP');

    const cookie = setCookie.split(';', 1)[0];
    const authed = await fetch(`${url}/events.json`, { headers: { cookie } });
    assert.equal(authed.status, 200, 'the login cookie authenticates later requests');

    // An over-large body is rejected instead of buffered.
    const huge = await fetch(`${url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${'a'.repeat(5000)}`,
      redirect: 'manual',
    });
    assert.equal(huge.status, 413);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('dashboard marks the login cookie Secure only when told to, never from forwarded headers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-secure-'));
  const eventLogPath = join(directory, 'events.jsonl');
  writeFileSync(eventLogPath, '', 'utf8');

  const token = 'secure-cookie-dashboard-token-0123456789';
  const logIn = (url, extraHeaders = {}) =>
    fetch(`${url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders },
      body: new URLSearchParams({ token }).toString(),
      redirect: 'manual',
    });

  const plain = await startDashboardServer({ eventLogPath, port: 0, authToken: token });
  try {
    const defaulted = await logIn(plain.url);
    assert.equal(defaulted.status, 303);
    assert.doesNotMatch(defaulted.headers.get('set-cookie') ?? '', /;\s*Secure/u, 'no Secure without opting in');

    // A client can send any forwarded header; none of them may set a cookie security attribute.
    const spoofed = await logIn(plain.url, { 'x-forwarded-proto': 'https' });
    assert.equal(spoofed.status, 303);
    assert.doesNotMatch(
      spoofed.headers.get('set-cookie') ?? '',
      /;\s*Secure/u,
      'a forwarded header must never add Secure'
    );
  } finally {
    await new Promise((resolve) => plain.server.close(resolve));
  }

  const secure = await startDashboardServer({ eventLogPath, port: 0, authToken: token, cookieSecure: true });
  try {
    const response = await logIn(secure.url);
    assert.equal(response.status, 303);
    const setCookie = response.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /;\s*Secure/u, 'cookieSecure marks the cookie for a TLS-terminating proxy');
    assert.match(setCookie, /HttpOnly/u);
    assert.match(setCookie, /SameSite=Strict/u);
  } finally {
    await new Promise((resolve) => secure.server.close(resolve));
  }
});

test('dashboard throttles repeated failed logins and clears the counter on success', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-ratelimit-'));
  const eventLogPath = join(directory, 'events.jsonl');
  writeFileSync(eventLogPath, '', 'utf8');

  const token = 'ratelimit-dashboard-token-0123456789';
  const { server, url } = await startDashboardServer({ eventLogPath, port: 0, authToken: token });

  const attempt = (value) =>
    fetch(`${url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: value }).toString(),
      redirect: 'manual',
    });

  try {
    // A few wrong guesses below the limit are ordinary 401s.
    for (let index = 0; index < 3; index++) {
      assert.equal((await attempt('wrong-token-value-000000000000')).status, 401);
    }

    // A correct token still works and resets the counter.
    assert.equal((await attempt(token)).status, 303, 'a correct token below the limit still works');

    // The reset means a fresh full burst is tolerated before the limiter trips.
    for (let index = 0; index < 10; index++) {
      assert.equal((await attempt('wrong-token-value-000000000000')).status, 401, 'the success reset the counter');
    }

    const throttled = await attempt('wrong-token-value-000000000000');
    assert.equal(throttled.status, 429, 'the next failed login is throttled');
    assert.match(throttled.headers.get('retry-after') ?? '', /^\d+$/u, 'Retry-After is a whole number of seconds');

    // The throttle is keyed by address, so it also refuses a correct token until the window passes.
    assert.equal((await attempt(token)).status, 429, 'the throttle covers the whole endpoint, not one guess');
    assert.equal(throttled.headers.get('cache-control'), 'no-store');

    // Reading the form is not a guessing attempt and stays available.
    assert.equal((await fetch(`${url}/login`)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('dashboard can bind remotely only with allow-remote and a valid token', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-dashboard-remote-'));
  const eventLogPath = join(directory, 'events.jsonl');
  writeFileSync(eventLogPath, '', 'utf8');

  const token = 'remote-dashboard-token-0123456789';
  const { server, url } = await startDashboardServer({
    eventLogPath,
    host: '0.0.0.0',
    port: 0,
    allowRemote: true,
    authToken: token,
  });

  try {
    assert.ok(url.startsWith('http://0.0.0.0:'), 'a non-loopback host binds as requested');
    const base = url.replace('0.0.0.0', '127.0.0.1');
    const anonymousJson = await fetch(`${base}/events.json`);
    assert.equal(anonymousJson.status, 401, 'a bound remote host still requires the token');
    const anonymousNavigation = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(anonymousNavigation.status, 303, 'a remote navigation is redirected to the login form');
    assert.equal(anonymousNavigation.headers.get('location'), '/login');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
