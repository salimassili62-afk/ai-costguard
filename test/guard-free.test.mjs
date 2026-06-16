import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { guard, guardFunction, GuardError, middleware } from '../dist/index.js';

function createClient() {
  let calls = 0;
  let metadataCalls = 0;
  return {
    get calls() {
      return calls;
    },
    get metadataCalls() {
      return metadataCalls;
    },
    metadata: {
      get: async () => {
        metadataCalls += 1;
        return { ok: true };
      },
    },
    chat: {
      completions: {
        create: async (params) => {
          calls += 1;
          if ('sessionId' in params || 'projectId' in params || 'userId' in params || 'runId' in params) {
            throw new Error('guard metadata leaked to provider');
          }
          return { ok: true, model: params.model, usage: { prompt_tokens: 10, completion_tokens: 5 } };
        },
      },
    },
  };
}

test('guard allows in-budget calls and exposes event controls', async () => {
  const client = createClient();
  const guarded = guard(client, { budget: 1 });
  const events = [];
  const unsubscribe = guarded.on('allow', (event) => events.push(event.type));

  const result = await guarded.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'write one unique greeting' }],
    max_tokens: 5,
    sessionId: 'unit-session',
    runId: 'unit-run',
  });

  unsubscribe();

  assert.equal(result.ok, true);
  assert.equal(client.calls, 1);
  assert.deepEqual(events, ['allow']);
  assert.equal(guarded.getGuardState().requestCount, 1);
  assert.ok(guarded.getGuardState().actualCost > 0);
});

test('guard blocks before the wrapped method is called', async () => {
  const client = createClient();
  const guarded = guard(client, { budget: 0.000001 });
  const blocks = [];
  guarded.on('block', (event) => blocks.push(event.reason));

  assert.throws(
    () =>
      guarded.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'expensive request' }],
        max_tokens: 1000,
      }),
    GuardError
  );

  assert.equal(client.calls, 0);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /Budget exceeded/);
});

test('guard ignores non-AI methods by default and supports explicit method filters', async () => {
  const client = createClient();
  const guarded = guard(client, { budget: 0 });

  const metadata = await guarded.metadata.get({ model: 'gpt-4', max_tokens: 1000 });
  assert.equal(metadata.ok, true);
  assert.equal(client.metadataCalls, 1);
  assert.equal(guarded.getGuardState().requestCount, 0);

  const custom = guard(
    {
      ai: {
        run: async () => ({ ok: true }),
      },
    },
    {
      budget: 1,
      guardedMethods: ['ai.run'],
      pricingOverrides: [
        {
          model: 'custom-model',
          inputPer1kTokens: 0.001,
          outputPer1kTokens: 0.002,
          lastUpdated: '2026-06-07',
          source: 'unit-test',
        },
      ],
    }
  );

  await custom.ai.run({ model: 'custom-model', prompt: 'custom', max_tokens: 10 });
  assert.equal(custom.getGuardState().requestCount, 1);
});

test('guardFunction protects standalone AI functions and exposes guard controls', async () => {
  let calls = 0;
  const runModel = guardFunction(
    async (params) => {
      calls += 1;
      return { ok: true, usage: { prompt_tokens: 5, completion_tokens: 5 }, params };
    },
    { budget: 1 }
  );

  const events = [];
  runModel.on('allow', (event) => events.push(event.type));

  const result = await runModel({
    model: 'gpt-4o-mini',
    prompt: 'standalone function prompt',
    max_tokens: 5,
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.deepEqual(events, ['allow']);
  assert.equal(runModel.getGuardState().requestCount, 1);
});

test('guard writes redacted JSONL event logs for local dashboard use', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'costguard-events-'));
  const eventLogPath = join(directory, 'events.jsonl');
  const guarded = guard(createClient(), {
    budget: 0.00001,
    eventLogPath,
    eventLogPrompt: 'none',
  });

  await guarded.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'private prompt should not be logged' }],
    max_tokens: 1,
  });

  assert.throws(
    () =>
      guarded.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'expensive private prompt' }],
        max_tokens: 1000,
      }),
    GuardError
  );

  const records = readFileSync(eventLogPath, 'utf8')
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));

  assert.ok(records.length >= 3);
  assert.ok(records.some((record) => record.type === 'allow'));
  assert.ok(records.some((record) => record.type === 'block' && record.code === 'BUDGET_EXCEEDED'));
  assert.equal(records.some((record) => 'promptPreview' in record), false);
});

test('guard sends Slack and Discord webhooks on block and silently ignores failures', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];

  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true };
  };

  try {
    const guarded = guard(createClient(), {
      budget: 0.000001,
      webhooks: {
        slack: 'https://hooks.slack.test/one',
        discord: 'https://discord.test/two',
        retries: 0,
      },
    });

    assert.throws(
      () =>
        guarded.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'block and notify' }],
          max_tokens: 1000,
        }),
      GuardError
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(urls.sort(), ['https://discord.test/two', 'https://hooks.slack.test/one']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('middleware attaches localSafety and guard aliases backed by shared state', () => {
  const req = {};
  let nextCalled = false;
  const mw = middleware({ budget: 0.0001 });

  mw(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.localSafety, req.guard);

  req.localSafety.check({
    model: 'gpt-4o-mini',
    tokens: 1,
    estimatedCost: 0.00001,
    timestamp: Date.now(),
    prompt: 'middleware unique prompt',
  });

  assert.equal(req.localSafety.state.requestCount, 1);

  assert.throws(
    () =>
      req.guard.check({
        model: 'gpt-4',
        tokens: 1000,
        estimatedCost: 1,
        timestamp: Date.now(),
        prompt: 'middleware expensive prompt',
      }),
    GuardError
  );
});
