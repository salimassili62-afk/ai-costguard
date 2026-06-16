import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GuardError } from '../dist/index.js';
import { GuardPro, getProGuard } from '../dist/pro.js';

class FakeRedis {
  status = 'wait';
  values = new Map();
  failEval = false;
  invalidEvalResult = false;
  deleted = [];

  on() {
    return this;
  }

  async connect() {
    this.status = 'ready';
  }

  async eval(_script, _keys, key, amount) {
    if (this.failEval) throw new Error('redis down');
    if (this.invalidEvalResult) return 'not-a-number';
    const next = Number(this.values.get(key) ?? '0') + Number(amount);
    this.values.set(key, String(next));
    return String(next);
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async del(key) {
    this.deleted.push(key);
    this.values.delete(key);
  }

  async quit() {
    this.status = 'end';
  }
}

async function waitForAlerts(ms = 25) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test('GuardPro charges Redis atomically and blocks over budget', async () => {
  const redis = new FakeRedis();
  const guard = new GuardPro({
    redisUrl: 'redis://unit',
    redisClient: redis,
    budget: 0.05,
    windowSeconds: 60,
  });

  await guard.checkAndCharge('project-a', 0.02);
  await guard.checkAndCharge('project-a', 0.02);
  assert.equal(await guard.getSpend('project-a'), 0.04);

  await assert.rejects(() => guard.checkAndCharge('project-a', 0.02), GuardError);
  assert.equal(redis.status, 'ready');

  await guard.resetSpend('project-a');
  assert.equal(await guard.getSpend('project-a'), 0);
});

test('GuardPro falls back to local state when Redis fails', async () => {
  const redis = new FakeRedis();
  redis.failEval = true;
  const guard = new GuardPro({
    redisUrl: 'redis://unit-failure',
    redisClient: redis,
    budget: 0.03,
    windowSeconds: 60,
  });

  await guard.checkAndCharge('project-b', 0.02);
  assert.equal(await guard.getSpend('project-b'), 0.02);

  await assert.rejects(() => guard.checkAndCharge('project-b', 0.02), /exceeded budget/);
});

test('GuardPro rejects invalid charges before mutating spend', async () => {
  const redis = new FakeRedis();
  const guard = new GuardPro({
    redisUrl: 'redis://unit-invalid',
    redisClient: redis,
    budget: 1,
    windowSeconds: 60,
  });

  await assert.rejects(() => guard.checkAndCharge('', 0.01), /projectId must be a non-empty string/);
  await assert.rejects(() => guard.checkAndCharge('project-c', -0.01), /estimatedCost must be a finite non-negative number/);
  await assert.rejects(() => guard.checkAndCharge('project-c', Number.NaN), /estimatedCost must be a finite non-negative number/);
  assert.equal(await guard.getSpend('project-c'), 0);
});

test('GuardPro falls back when Redis returns an invalid total', async () => {
  const redis = new FakeRedis();
  redis.invalidEvalResult = true;
  const guard = new GuardPro({
    redisUrl: 'redis://unit-invalid-total',
    redisClient: redis,
    budget: 1,
    windowSeconds: 60,
  });

  await guard.checkAndCharge('project-d', 0.25);
  assert.equal(await guard.getSpend('project-d'), 0.25);
});

test('GuardPro factory creates guards', () => {
  assert.ok(getProGuard({ redisUrl: 'redis://unit', budget: 1 }) instanceof GuardPro);
});

test('GuardPro blocked call triggers one raw webhook alert and still throws GuardError', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const redis = new FakeRedis();

  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return { ok: true };
  };

  try {
    const guard = new GuardPro({
      redisUrl: 'redis://unit-alert',
      redisClient: redis,
      budget: 0.01,
      projectId: 'configured-project',
      runId: 'run-1',
      alerts: {
        webhookUrl: 'https://alerts.test/pro',
        events: ['blocked'],
        timeoutMs: 100,
      },
    });

    await assert.rejects(() => guard.checkAndCharge('redis-project', 0.02), (error) => {
      assert.ok(error instanceof GuardError);
      assert.equal(error.code, 'BUDGET_EXCEEDED');
      return true;
    });
    await waitForAlerts();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://alerts.test/pro');
    assert.equal(requests[0].body.event, 'blocked');
    assert.equal(requests[0].body.reason, 'budget_exceeded');
    assert.equal(requests[0].body.severity, 'critical');
    assert.equal(requests[0].body.projectId, 'configured-project');
    assert.equal(requests[0].body.runId, 'run-1');
    assert.equal(requests[0].body.packageName, '@salimassili/ai-costguard');
    assert.equal(requests[0].body.budgetLimitUsd, 0.01);
    assert.equal(requests[0].body.budgetUsedUsd, 0.02);
    assert.equal(requests[0].body.estimatedSavedUsd, 0.02);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GuardPro webhook failure and timeout do not swallow blocks or crash', async () => {
  const originalFetch = globalThis.fetch;
  const redisFailure = new FakeRedis();

  globalThis.fetch = async () => {
    throw new Error('network unavailable');
  };

  try {
    const guard = new GuardPro({
      redisUrl: 'redis://unit-alert-failure',
      redisClient: redisFailure,
      budget: 0.01,
      alerts: { webhookUrl: 'https://alerts.test/failure', events: ['blocked'], timeoutMs: 100 },
    });

    await assert.rejects(() => guard.checkAndCharge('project-failure', 0.02), (error) => {
      assert.ok(error instanceof GuardError);
      assert.equal(error.code, 'BUDGET_EXCEEDED');
      assert.doesNotMatch(error.message, /alerts\.test|webhook/u);
      return true;
    });
    await waitForAlerts();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const redisTimeout = new FakeRedis();
  let aborted = false;

  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      });
    });

  try {
    const guard = new GuardPro({
      redisUrl: 'redis://unit-alert-timeout',
      redisClient: redisTimeout,
      budget: 0.01,
      alerts: { webhookUrl: 'https://alerts.test/slow', events: ['blocked'], timeoutMs: 5 },
    });

    await assert.rejects(() => guard.checkAndCharge('project-timeout', 0.02), GuardError);
    await waitForAlerts(125);
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GuardPro event filtering and threshold alerts work independently', async () => {
  const originalFetch = globalThis.fetch;
  const payloads = [];

  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(String(init.body)));
    return { ok: true };
  };

  try {
    const blockFiltered = new GuardPro({
      redisUrl: 'redis://unit-alert-filter',
      redisClient: new FakeRedis(),
      budget: 0.01,
      alerts: { webhookUrl: 'https://alerts.test/filter', events: ['threshold'], timeoutMs: 100 },
    });

    await assert.rejects(() => blockFiltered.checkAndCharge('project-filter', 0.02), GuardError);
    await waitForAlerts();
    assert.equal(payloads.length, 0);

    const thresholdGuard = new GuardPro({
      redisUrl: 'redis://unit-alert-threshold',
      redisClient: new FakeRedis(),
      budget: { maxUsd: 1, thresholdUsd: 0.02 },
      alerts: { webhookUrl: 'https://alerts.test/threshold', events: ['threshold'], timeoutMs: 100 },
    });

    await thresholdGuard.checkAndCharge('project-threshold', 0.01);
    await thresholdGuard.checkAndCharge('project-threshold', 0.01);
    await thresholdGuard.checkAndCharge('project-threshold', 0.01);
    await waitForAlerts();

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].event, 'threshold');
    assert.equal(payloads[0].reason, 'budget_threshold');
    assert.equal(payloads[0].severity, 'warning');
    assert.equal(payloads[0].budgetUsedUsd, 0.02);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GuardPro Slack format creates a Slack-compatible payload', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];

  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    return { ok: true };
  };

  try {
    const guard = new GuardPro({
      redisUrl: 'redis://unit-alert-slack',
      redisClient: new FakeRedis(),
      budget: 0.01,
      alerts: {
        webhookUrl: 'https://hooks.slack.test/pro-secret',
        events: ['blocked'],
        format: 'slack',
        timeoutMs: 100,
      },
    });

    await assert.rejects(() => guard.checkAndCharge('project-slack', 0.02), GuardError);
    await waitForAlerts();

    assert.equal(bodies.length, 1);
    assert.deepEqual(Object.keys(bodies[0]), ['text']);
    assert.match(bodies[0].text, /AI CostGuard blocked budget exceeded before provider call/u);
    assert.doesNotMatch(bodies[0].text, /hooks\.slack|pro-secret/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GuardPro alert payload redacts prompts, secrets, request bodies, and webhook URLs', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];

  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init.body));
    return { ok: true };
  };

  try {
    const guard = new GuardPro({
      redisUrl: 'redis://unit-alert-redaction',
      redisClient: new FakeRedis(),
      budget: 0.01,
      runId: 'run-1',
      alerts: {
        webhookUrl: 'https://alerts.test/secret-webhook-url',
        events: ['blocked'],
        timeoutMs: 100,
      },
    });

    await assert.rejects(() => guard.checkAndCharge('safe-project', 0.02), GuardError);
    await waitForAlerts();

    assert.equal(bodies.length, 1);
    assert.doesNotMatch(
      bodies[0],
      /prompt|apiKey|authorization|sk-test-secret|secret-webhook-url|request body|headers/u
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
