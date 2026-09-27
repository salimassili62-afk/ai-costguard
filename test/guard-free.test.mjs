import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { guard, guardFunction, GuardError, middleware } from '../dist/esm/index.js';
import { daysAgo } from './helpers/dates.mjs';

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

test('provider failure keeps the conservative reservation and records no actual spend', async () => {
  let calls = 0;
  const guarded = guard(
    {
      chat: {
        completions: {
          create: async () => {
            calls += 1;
            throw new Error('provider failed');
          },
        },
      },
    },
    { budget: 1 }
  );

  await assert.rejects(
    () => guarded.chat.completions.create({ model: 'gpt-4o-mini', prompt: 'provider failure', max_tokens: 10 }),
    /provider failed/
  );
  const state = guarded.getGuardState();
  assert.equal(calls, 1);
  assert.equal(state.requestCount, 1);
  assert.ok(state.reservedCost > 0);
  assert.equal(state.actualCost, 0);
});

test('guard rejects streaming before the provider method executes', async () => {
  const client = createClient();
  const guarded = guard(client, { budget: 1 });

  assert.throws(
    () =>
      guarded.chat.completions.create({
        model: 'gpt-4o-mini',
        prompt: 'streaming request',
        max_tokens: 10,
        stream: true,
      }),
    (error) => error instanceof GuardError && error.code === 'STREAMING_UNSUPPORTED'
  );
  assert.equal(client.calls, 0);
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
          lastUpdated: daysAgo(1),
          source: 'unit-test',
        },
      ],
    }
  );

  await custom.ai.run({ model: 'custom-model', prompt: 'custom', max_tokens: 10 });
  assert.equal(custom.getGuardState().requestCount, 1);
});

test('guard keeps shared nested objects isolated by method path', async () => {
  let calls = 0;
  const shared = {
    create: async () => {
      calls += 1;
      return { ok: true };
    },
  };
  const guarded = guard(
    { first: { shared }, second: { shared } },
    {
      budget: 1,
      guardedMethods: ['first.shared.create'],
      pricingOverrides: [
        {
          model: 'shared-model',
          inputPer1kTokens: 0.001,
          outputPer1kTokens: 0.001,
          lastUpdated: daysAgo(1),
          source: 'unit-test',
        },
      ],
    }
  );

  await guarded.second.shared.create({ model: 'shared-model', prompt: 'pass through', max_tokens: 1 });
  assert.equal(calls, 1);
  assert.equal(guarded.getGuardState().requestCount, 0);
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

test('guard event controls exist only on the root proxy, never shadowing client methods', async () => {
  // `on`, `off`, and `getGuardState` are the guard's own controls. Intercepting them at every
  // nesting depth silently replaced any client method with the same name, so an EventEmitter-style
  // client would stop working the moment it was guarded.
  const client = {
    on: () => 'root-on',
    nested: {
      on: () => 'nested-on',
      off: () => 'nested-off',
      getGuardState: () => 'nested-state',
    },
  };

  const guarded = guard(client, { budget: 1, behaviorAnalysis: false });

  // The root is the one documented exception: the guard's controls live there, so a root-level
  // client method with the same name is shadowed. Nested access is never affected.
  assert.notEqual(guarded.on, client.on, 'at the root the guard control takes precedence, as documented');
  assert.equal(guarded.nested.on(), 'nested-on', 'a nested client `on` must not be shadowed');
  assert.equal(guarded.nested.off(), 'nested-off', 'a nested client `off` must not be shadowed');
  assert.equal(guarded.nested.getGuardState(), 'nested-state', 'a nested client getGuardState must not be shadowed');
  assert.equal(client.nested.on(), 'nested-on', 'the unwrapped client is untouched');

  // The guard controls are still available and still receive events, on the root proxy.
  const events = [];
  const unsubscribe = guarded.on('allow', (event) => events.push(event.type));
  assert.equal(typeof unsubscribe, 'function');
  unsubscribe();

  const costed = guard(createClient(), { budget: 1, behaviorAnalysis: false });
  const seen = [];
  costed.on('allow', (event) => seen.push(event.type));
  await costed.chat.completions.create({
    model: 'gpt-4o-mini',
    prompt: 'root control still receives events',
    max_tokens: 5,
  });
  assert.deepEqual(seen, ['allow'], 'the root proxy still delivers guard events');
  assert.equal(costed.getGuardState().requestCount, 1);
});

test('guardFunction can protect a function whose method name collides with a guard control', async () => {
  // The function is parked one level below the root proxy precisely so a name such as `on` cannot
  // resolve to the guard's subscription API instead of the caller's function.
  for (const methodName of ['on', 'off', 'getGuardState', 'run']) {
    let calls = 0;
    const guardedFn = guardFunction(
      async () => {
        calls += 1;
        return { ok: true, usage: { prompt_tokens: 5, completion_tokens: 5 } };
      },
      { budget: 1, behaviorAnalysis: false, guardedMethods: [methodName] }
    );

    const result = await guardedFn({
      model: 'gpt-4o-mini',
      prompt: `standalone function named ${methodName}`,
      max_tokens: 5,
    });

    assert.equal(result.ok, true, `guardFunction must still call the function when named "${methodName}"`);
    assert.equal(calls, 1, `guardFunction must call the function exactly once when named "${methodName}"`);
    assert.equal(guardedFn.getGuardState().requestCount, 1, `"${methodName}" must still be cost-checked`);
    assert.equal(typeof guardedFn.on, 'function', 'the guard subscription control is still exposed');
  }
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
    pricingKnown: true,
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
        pricingKnown: true,
        tokens: 1000,
        estimatedCost: 1,
        timestamp: Date.now(),
        prompt: 'middleware expensive prompt',
      }),
    GuardError
  );
});
