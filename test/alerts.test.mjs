import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guard, GuardError } from '../dist/index.js';
import { GuardCore } from '../dist/core/GuardCore.js';

function createClient() {
  let calls = 0;

  return {
    get calls() {
      return calls;
    },
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return { ok: true };
        },
      },
    },
  };
}

function blockRequest(guarded) {
  return guarded.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'user',
        content: 'secret prompt with sk-test-secret and private customer data',
      },
    ],
    headers: { authorization: 'Bearer sk-test-secret' },
    apiKey: 'sk-test-secret',
    max_tokens: 1000,
  });
}

async function waitForAlerts() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

test('blocked call triggers one raw webhook alert before provider execution', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const client = createClient();

  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return { ok: true };
  };

  try {
    const guarded = guard(client, {
      budget: { maxUsd: 0.000001 },
      projectId: 'demo-agent',
      runId: 'run-1',
      alerts: {
        webhookUrl: 'https://alerts.test/webhook',
        events: ['blocked'],
        timeoutMs: 100,
      },
    });

    assert.throws(() => blockRequest(guarded), (error) => error instanceof GuardError && error.code === 'BUDGET_EXCEEDED');
    await waitForAlerts();

    assert.equal(client.calls, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://alerts.test/webhook');
    assert.equal(requests[0].body.event, 'blocked');
    assert.equal(requests[0].body.reason, 'budget_exceeded');
    assert.equal(requests[0].body.severity, 'critical');
    assert.equal(requests[0].body.projectId, 'demo-agent');
    assert.equal(requests[0].body.runId, 'run-1');
    assert.equal(requests[0].body.model, 'gpt-4');
    assert.equal(requests[0].body.provider, 'openai');
    assert.equal(requests[0].body.packageName, '@salimassili/ai-costguard');
    assert.ok(requests[0].body.estimatedSavedUsd > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webhook failure preserves the original guard block', async () => {
  const originalFetch = globalThis.fetch;
  const client = createClient();

  globalThis.fetch = async () => {
    throw new Error('network unavailable');
  };

  try {
    const guarded = guard(client, {
      budget: { maxUsd: 0.000001 },
      alerts: { webhookUrl: 'https://alerts.test/fails', events: ['blocked'], timeoutMs: 100 },
    });

    assert.throws(() => blockRequest(guarded), (error) => {
      assert.ok(error instanceof GuardError);
      assert.equal(error.code, 'BUDGET_EXCEEDED');
      assert.doesNotMatch(error.message, /alerts\.test|webhook|sk-test-secret/u);
      return true;
    });

    await waitForAlerts();
    assert.equal(client.calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webhook timeout does not crash guarded applications', async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;

  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      });
    });

  try {
    const guarded = guard(createClient(), {
      budget: { maxUsd: 0.000001 },
      alerts: { webhookUrl: 'https://alerts.test/slow', events: ['blocked'], timeoutMs: 5 },
    });

    assert.throws(() => blockRequest(guarded), GuardError);
    await new Promise((resolve) => setTimeout(resolve, 125));
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('alert event filtering and threshold alerts work independently', async () => {
  const originalFetch = globalThis.fetch;
  const payloads = [];

  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(String(init.body)));
    return { ok: true };
  };

  try {
    const blockOnlyFiltered = guard(createClient(), {
      budget: { maxUsd: 0.000001 },
      alerts: { webhookUrl: 'https://alerts.test/filtered', events: ['threshold'], timeoutMs: 100 },
    });

    assert.throws(() => blockRequest(blockOnlyFiltered), GuardError);
    await waitForAlerts();
    assert.equal(payloads.length, 0);

    const thresholdGuarded = guard(createClient(), {
      budget: { maxUsd: 1, thresholdUsd: 0.000001 },
      alerts: { webhookUrl: 'https://alerts.test/threshold', events: ['threshold'], timeoutMs: 100 },
    });

    await thresholdGuarded.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'short threshold test' }],
      max_tokens: 10,
    });
    await waitForAlerts();

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].event, 'threshold');
    assert.equal(payloads[0].reason, 'budget_threshold');
    assert.equal(payloads[0].severity, 'warning');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slack alert format sends a Slack-compatible body', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];

  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    return { ok: true };
  };

  try {
    const guarded = guard(createClient(), {
      budget: { maxUsd: 0.000001 },
      alerts: {
        webhookUrl: 'https://hooks.slack.test/local',
        events: ['blocked'],
        format: 'slack',
        timeoutMs: 100,
      },
    });

    assert.throws(() => blockRequest(guarded), GuardError);
    await waitForAlerts();

    assert.equal(bodies.length, 1);
    assert.equal(Object.keys(bodies[0]).length, 1);
    assert.match(bodies[0].text, /AI CostGuard blocked budget exceeded before provider call/u);
    assert.doesNotMatch(bodies[0].text, /hooks\.slack|sk-test-secret/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('alert payloads redact prompts, secrets, request bodies, and webhook URLs', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];

  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init.body));
    return { ok: true };
  };

  try {
    const guarded = guard(createClient(), {
      budget: { maxUsd: 0.000001 },
      alerts: { webhookUrl: 'https://alerts.test/secret-webhook', events: ['blocked'], timeoutMs: 100 },
    });

    assert.throws(() => blockRequest(guarded), GuardError);
    await waitForAlerts();

    assert.equal(bodies.length, 1);
    assert.doesNotMatch(bodies[0], /secret prompt|private customer data|sk-test-secret|authorization|secret-webhook/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid budgets fail early and invalid manual estimated costs are sanitized', () => {
  assert.throws(() => new GuardCore({ budget: Number.NaN }), /budget must be a non-negative finite number/u);
  assert.throws(() => new GuardCore({ budget: { maxUsd: -1 } }), /budget\.maxUsd/u);
  assert.throws(() => new GuardCore({ budget: { maxUsd: 1, thresholdPercent: 2 } }), /budget\.thresholdPercent/u);

  const core = new GuardCore({ budget: 1 });
  core.check({
    model: 'gpt-4o-mini',
    tokens: Number.NaN,
    estimatedCost: Number.POSITIVE_INFINITY,
    timestamp: Number.NaN,
    prompt: 'manual bad cost',
  });
  core.check({
    model: 'gpt-4o-mini',
    tokens: -10,
    estimatedCost: -1,
    timestamp: Date.now(),
    prompt: 'manual negative cost',
  });

  assert.equal(core.getState().attemptedCost, 0);
  assert.equal(core.getState().totalCost, 0);
  assert.equal(core.getState().requestCount, 2);
});
