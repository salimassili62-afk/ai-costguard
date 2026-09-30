import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GuardError } from '../dist/esm/index.js';
import { GuardPro, getProGuard } from '../dist/esm/pro.js';

const MONEY_SCALE = 1_000_000;

function toUsd(micros) {
  const whole = Math.trunc(micros / MONEY_SCALE);
  const fraction = micros - whole * MONEY_SCALE;
  const text = String(fraction).padStart(6, '0').replace(/0+$/, '');
  return text === '' ? String(whole) : `${whole}.${text}`;
}

class FakeRedis {
  status = 'wait';
  values = new Map();
  ttls = new Map();
  scripts = [];
  failEval = false;
  invalidEvalResult = false;
  deleted = [];

  on() {
    return this;
  }

  async connect() {
    this.status = 'ready';
  }

  /** Mirrors the integer micro-dollar semantics of the bundled Lua script. */
  async eval(script, _keys, key, amount, ttlSeconds, budget) {
    this.scripts.push(script);
    if (this.failEval) throw new Error('redis down');
    if (this.invalidEvalResult) return 'not-a-number';

    const stored = this.values.get(key);
    let current = 0;
    if (stored !== undefined) {
      const storedNumber = Number(stored);
      if (!Number.isFinite(storedNumber) || storedNumber < 0) {
        throw new Error('ai-costguard: unreadable spend value');
      }
      current = Math.round(storedNumber * MONEY_SCALE);
    }

    const projected = current + Number(amount);
    if (projected > Number(budget)) {
      return [0, toUsd(current), toUsd(projected)];
    }

    const previousTtl = this.ttls.get(key);
    this.values.set(key, toUsd(projected));
    this.ttls.set(key, previousTtl !== undefined && previousTtl >= 1 ? previousTtl : Number(ttlSeconds));
    return [1, toUsd(projected), toUsd(projected)];
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async del(key) {
    this.deleted.push(key);
    this.values.delete(key);
    this.ttls.delete(key);
  }

  async quit() {
    this.status = 'end';
  }
}

class StatuslessRedis extends FakeRedis {
  status = undefined;

  constructor() {
    super();
    this.listeners = new Map();
  }

  on(eventName, handler) {
    const handlers = this.listeners.get(eventName) ?? [];
    handlers.push(handler);
    this.listeners.set(eventName, handlers);
    return this;
  }

  emit(eventName) {
    for (const handler of this.listeners.get(eventName) ?? []) handler();
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
  assert.equal(await guard.getSpend('project-a'), 0.04);
  assert.equal(redis.status, 'ready');

  await guard.resetSpend('project-a');
  assert.equal(await guard.getSpend('project-a'), 0);
});

test('GuardPro fails closed when Redis shared enforcement fails', async () => {
  const redis = new FakeRedis();
  redis.failEval = true;
  const guard = new GuardPro({
    redisUrl: 'redis://unit-failure',
    redisClient: redis,
    budget: 0.03,
    windowSeconds: 60,
  });

  await assert.rejects(
    () => guard.checkAndCharge('project-b', 0.02),
    (error) => error instanceof GuardError && error.code === 'SHARED_BUDGET_UNAVAILABLE'
  );
  await assert.rejects(() => guard.getSpend('project-b'), /Shared budget enforcement is unavailable/);
});

test('GuardPro local fallback requires explicit opt-in', async () => {
  const redis = new FakeRedis();
  redis.failEval = true;
  const guard = new GuardPro({
    redisUrl: 'redis://unit-explicit-fallback',
    redisClient: redis,
    budget: 0.03,
    allowLocalFallback: true,
    windowSeconds: 60,
  });

  await guard.checkAndCharge('project-b', 0.02);
  assert.equal(await guard.getSpend('project-b'), 0.02);
  await assert.rejects(() => guard.checkAndCharge('project-b', 0.02), /would exceed budget/);
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

test('GuardPro fails closed when Redis returns an invalid decision', async () => {
  const redis = new FakeRedis();
  redis.invalidEvalResult = true;
  const guard = new GuardPro({
    redisUrl: 'redis://unit-invalid-total',
    redisClient: redis,
    budget: 1,
    windowSeconds: 60,
  });

  await assert.rejects(
    () => guard.checkAndCharge('project-d', 0.25),
    (error) => error instanceof GuardError && error.code === 'SHARED_BUDGET_UNAVAILABLE'
  );
});

test('GuardPro factory creates guards', () => {
  assert.ok(getProGuard({ redisUrl: 'redis://unit', budget: 1 }) instanceof GuardPro);
});

test('GuardPro construction does not require runtime licensing', () => {
  assert.doesNotThrow(() => new GuardPro({ redisUrl: 'redis://unit', budget: 1, windowSeconds: 60 }));
});

test('GuardPro rejects invalid windowSeconds configuration', () => {
  for (const windowSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => new GuardPro({ redisUrl: 'redis://unit', budget: 1, windowSeconds }),
      (error) => error instanceof GuardError && error.code === 'CONFIG_INVALID' && /windowSeconds/u.test(error.message)
    );
  }
});

test('GuardPro rejects invalid project identifiers with CONFIG_INVALID', async () => {
  const guard = new GuardPro({ redisUrl: '', budget: 1, windowSeconds: 60 });

  await assert.rejects(
    () => guard.checkAndCharge(42, 0.01),
    (error) => error instanceof GuardError && error.code === 'CONFIG_INVALID'
  );
  await assert.rejects(
    () => guard.getSpend(''),
    (error) => error instanceof GuardError && error.code === 'CONFIG_INVALID'
  );
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
    assert.equal(requests[0].body.budgetUsedUsd, 0);
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

test('GuardPro allows a charge that lands exactly on the budget boundary', async () => {
  const redis = new FakeRedis();
  const guard = new GuardPro({ redisUrl: 'redis://unit-boundary', redisClient: redis, budget: 0.3, windowSeconds: 60 });

  await guard.checkAndCharge('project-boundary', 0.2);
  await guard.checkAndCharge('project-boundary', 0.1);

  assert.equal(await guard.getSpend('project-boundary'), 0.3);
  assert.equal(redis.values.get('costguard:spend:project-boundary'), '0.3');

  await assert.rejects(
    () => guard.checkAndCharge('project-boundary', 0.000001),
    (error) => error instanceof GuardError && error.code === 'BUDGET_EXCEEDED'
  );
  assert.equal(await guard.getSpend('project-boundary'), 0.3);
});

test('GuardPro never stores more than six decimal places', async () => {
  const redis = new FakeRedis();
  const guard = new GuardPro({ redisUrl: 'redis://unit-scale', redisClient: redis, budget: 1, windowSeconds: 60 });

  for (const amount of [0.1, 0.2]) {
    await guard.checkAndCharge('project-scale', amount);
  }

  assert.equal(redis.values.get('costguard:spend:project-scale'), '0.3');
  assert.equal(await guard.getSpend('project-scale'), 0.3);
  assert.equal(0.2 + 0.1 > 0.3, true, 'precondition: float math rejects this boundary');
});

test('GuardPro normalizes legacy float-drifted spend values', async () => {
  const redis = new FakeRedis();
  redis.values.set('costguard:spend:project-legacy', '0.30000000000000004');
  const guard = new GuardPro({ redisUrl: 'redis://unit-legacy', redisClient: redis, budget: 0.3, windowSeconds: 60 });

  assert.equal(await guard.getSpend('project-legacy'), 0.3);

  await assert.rejects(
    () => guard.checkAndCharge('project-legacy', 0.000001),
    (error) => error instanceof GuardError && error.code === 'BUDGET_EXCEEDED'
  );
  assert.equal(redis.values.get('costguard:spend:project-legacy'), '0.30000000000000004');
});

test('GuardPro fails closed on an unreadable stored spend value', async () => {
  const redis = new FakeRedis();
  redis.values.set('costguard:spend:project-corrupt', 'not-a-number');
  const guard = new GuardPro({ redisUrl: 'redis://unit-corrupt', redisClient: redis, budget: 1, windowSeconds: 60 });

  await assert.rejects(
    () => guard.checkAndCharge('project-corrupt', 0.01),
    (error) => error instanceof GuardError && error.code === 'SHARED_BUDGET_UNAVAILABLE'
  );
  await assert.rejects(
    () => guard.getSpend('project-corrupt'),
    (error) => error instanceof GuardError && error.code === 'SHARED_BUDGET_UNAVAILABLE'
  );
});

test('GuardPro concurrent shared charges never overspend', async () => {
  const redis = new FakeRedis();
  const guard = new GuardPro({ redisUrl: 'redis://unit-concurrent', redisClient: redis, budget: 0.1, windowSeconds: 60 });

  const results = await Promise.allSettled(
    Array.from({ length: 50 }, () => guard.checkAndCharge('project-concurrent', 0.01))
  );

  const allowed = results.filter((result) => result.status === 'fulfilled').length;
  const blocked = results.filter(
    (result) => result.status === 'rejected' && result.reason instanceof GuardError && result.reason.code === 'BUDGET_EXCEEDED'
  ).length;

  assert.equal(allowed, 10);
  assert.equal(blocked, 40);
  assert.equal(await guard.getSpend('project-concurrent'), 0.1);
});

test('GuardPro Redis and local fallback accounting agree at exact boundaries', async () => {
  const amounts = [0.2, 0.1, 0.000001, 0.05];

  const shared = new GuardPro({
    redisUrl: 'redis://unit-parity-shared',
    redisClient: new FakeRedis(),
    budget: 0.3,
    windowSeconds: 60,
  });
  const failedRedis = new FakeRedis();
  failedRedis.failEval = true;
  const local = new GuardPro({
    redisUrl: 'redis://unit-parity-local',
    redisClient: failedRedis,
    budget: 0.3,
    windowSeconds: 60,
    allowLocalFallback: true,
  });

  for (const amount of amounts) {
    const sharedOutcome = await shared.checkAndCharge('project-parity', amount).then(() => 'allowed', () => 'blocked');
    const localOutcome = await local.checkAndCharge('project-parity', amount).then(() => 'allowed', () => 'blocked');
    assert.equal(sharedOutcome, localOutcome, `parity mismatch at ${amount}`);
  }

  assert.equal(await shared.getSpend('project-parity'), 0.3);
  assert.equal(await local.getSpend('project-parity'), 0.3);
});

test('GuardPro spend script uses integer micro-dollar math', async () => {
  const redis = new FakeRedis();
  const guard = new GuardPro({ redisUrl: 'redis://unit-script', redisClient: redis, budget: 1, windowSeconds: 60 });

  await guard.checkAndCharge('project-script', 0.01);

  assert.equal(redis.scripts.length, 1);
  const [script] = redis.scripts;
  assert.doesNotMatch(script, /INCRBYFLOAT/u);
  assert.match(script, /SCALE = 1000000/u);
  assert.match(script, /projected > budget/u);
  assert.match(script, /redis\.call\("SET", KEYS\[1\]/u);
  assert.equal(redis.ttls.get('costguard:spend:project-script'), 60);
});

test('GuardPro preserves an existing window TTL instead of resetting it', async () => {
  const redis = new FakeRedis();
  const guard = new GuardPro({ redisUrl: 'redis://unit-ttl', redisClient: redis, budget: 1, windowSeconds: 3_600 });
  redis.ttls.set('costguard:spend:project-ttl', 120);

  await guard.checkAndCharge('project-ttl', 0.01);
  assert.equal(redis.ttls.get('costguard:spend:project-ttl'), 120);

  await guard.resetSpend('project-ttl');
  assert.equal(redis.ttls.get('costguard:spend:project-ttl'), undefined);
});

/**
 * Boundary equivalence between the authoritative Redis path and the in-process fallback.
 *
 * A caller that fails over between the two must never observe a different allow/block answer, so
 * this drives identical charge sequences down both paths and requires the decisions and the
 * resulting totals to match exactly. The cases deliberately include the values that used to
 * disagree: `chargeLocal` previously rounded the *sum* to 6 decimals and compared it against an
 * unrounded budget, while Redis rounded the budget and the charge independently to integer
 * micro-dollars. With a budget of `0.0000005` and a charge of `0.000001` both sides collapse to
 * `1` micro-dollar, so the authoritative `1 > 1` allows while the old local comparison blocked.
 */
const MONEY_BOUNDARY_CASES = [
  { budget: 0.05, charges: [0.02, 0.02, 0.02], label: 'exact decimal accumulation' },
  { budget: 0.3, charges: [0.1, 0.1, 0.1], label: 'float-unsafe decimal accumulation' },
  { budget: 0.3, charges: [0.2, 0.1], label: 'charge lands exactly on the budget' },
  { budget: 0.3, charges: [0.2, 0.1, 0.000001], label: 'one micro-dollar over the budget' },
  { budget: 0.0000005, charges: [0.000001], label: 'sub-micro budget, charge rounds up' },
  { budget: 0.000001, charges: [0.0000005], label: 'sub-micro charge rounds up' },
  { budget: 0.000001, charges: [0.000001], label: 'both sides exactly one micro-dollar' },
  { budget: 0.000002, charges: [0.000001, 0.000001], label: 'two micro-dollar charges' },
  { budget: 0.000002, charges: [0.000001, 0.000001, 0.000001], label: 'third micro-dollar exceeds' },
  { budget: 0, charges: [0], label: 'zero budget accepts a zero charge' },
  { budget: 0, charges: [0.000001], label: 'zero budget rejects any charge' },
  { budget: 0.1, charges: [0.099999, 0.0000015], label: 'charges summing across the boundary' },
  { budget: 1e-9, charges: [1e-9], label: 'sub-micro budget and sub-micro charge' },
  { budget: 1e-9, charges: [1e-9, 1e-9], label: 'sub-micro budget, second charge exceeds' },
];

for (const boundaryCase of MONEY_BOUNDARY_CASES) {
  test(`GuardPro local fallback matches the Redis decision: ${boundaryCase.label}`, async () => {
    const sharedRedis = new FakeRedis();
    const shared = new GuardPro({
      redisUrl: 'redis://unit-equivalence-shared',
      redisClient: sharedRedis,
      budget: boundaryCase.budget,
      windowSeconds: 60,
    });

    const failingRedis = new FakeRedis();
    failingRedis.failEval = true;
    const local = new GuardPro({
      redisUrl: 'redis://unit-equivalence-local',
      redisClient: failingRedis,
      budget: boundaryCase.budget,
      allowLocalFallback: true,
      windowSeconds: 60,
    });

    const sharedDecisions = [];
    const localDecisions = [];

    for (const charge of boundaryCase.charges) {
      const decide = async (guard, sink) => {
        try {
          await guard.checkAndCharge('project-equivalence', charge);
          sink.push(true);
        } catch (error) {
          assert.ok(error instanceof GuardError, 'a block must be a GuardError, not a raw failure');
          sink.push(false);
        }
      };

      await decide(shared, sharedDecisions);
      await decide(local, localDecisions);
    }

    assert.deepEqual(
      localDecisions,
      sharedDecisions,
      `allow/block decisions diverged for budget ${boundaryCase.budget} with charges ${JSON.stringify(boundaryCase.charges)}`
    );
    assert.equal(
      await local.getSpend('project-equivalence'),
      await shared.getSpend('project-equivalence'),
      'the resulting spend totals diverged for the same charge sequence'
    );
  });
}

test('GuardPro local fallback allows a charge that Redis allows at the same boundary', async () => {
  // The exact regression, pinned on its own so a future change cannot make the differential suite
  // above pass by accident. Budget $0.0000005 and a $0.000001 charge both quantize to 1 micro-dollar,
  // so the authoritative integer comparison `1 > 1` is false and the charge is allowed.
  const failingRedis = new FakeRedis();
  failingRedis.failEval = true;
  const local = new GuardPro({
    redisUrl: 'redis://unit-submicro',
    redisClient: failingRedis,
    budget: 0.0000005,
    allowLocalFallback: true,
    windowSeconds: 60,
  });

  const sharedRedis = new FakeRedis();
  const shared = new GuardPro({
    redisUrl: 'redis://unit-submicro-shared',
    redisClient: sharedRedis,
    budget: 0.0000005,
    windowSeconds: 60,
  });

  await local.checkAndCharge('project-submicro', 0.000001);
  await shared.checkAndCharge('project-submicro', 0.000001);

  assert.equal(await local.getSpend('project-submicro'), 0.000001);
  assert.equal(await shared.getSpend('project-submicro'), 0.000001);
});

test('GuardPro local fallback accumulates micro-dollar charges without float drift', async () => {
  const failingRedis = new FakeRedis();
  failingRedis.failEval = true;
  const guard = new GuardPro({
    redisUrl: 'redis://unit-micro-accum',
    redisClient: failingRedis,
    budget: 1,
    allowLocalFallback: true,
    windowSeconds: 60,
  });

  // 0.1 + 0.2 is 0.30000000000000004 in IEEE-754. The integer path must not inherit that.
  for (let i = 0; i < 3; i++) await guard.checkAndCharge('project-micro-accum', 0.1);
  assert.equal(await guard.getSpend('project-micro-accum'), 0.3);
});

const liveRedisUrl = process.env.COSTGUARD_REDIS_URL;

test('GuardPro shared spend is exact against a live Redis', { skip: !liveRedisUrl }, async (t) => {
  const { default: Redis } = await import('ioredis');
  const projectId = `live-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const key = `costguard:spend:${projectId}`;
  const client = new Redis(liveRedisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  const guard = new GuardPro({ redisUrl: liveRedisUrl, redisClient: client, budget: 0.3, windowSeconds: 60 });

  t.after(async () => {
    try {
      await client.del(key);
    } finally {
      await client.quit().catch(() => undefined);
    }
  });

  await guard.checkAndCharge(projectId, 0.2);
  await guard.checkAndCharge(projectId, 0.1);

  assert.equal(await client.get(key), '0.3');
  assert.equal(await guard.getSpend(projectId), 0.3);
  assert.ok((await client.ttl(key)) > 0);

  await assert.rejects(
    () => guard.checkAndCharge(projectId, 0.000001),
    (error) => error instanceof GuardError && error.code === 'BUDGET_EXCEEDED'
  );
  assert.equal(await client.get(key), '0.3');

  await guard.resetSpend(projectId);
  assert.equal(await guard.getSpend(projectId), 0);
});

test('GuardPro connects a status-less client once and reuses it', async () => {
  const redis = new StatuslessRedis();
  let connectCalls = 0;
  redis.connect = async () => {
    connectCalls += 1;
    redis.emit('ready');
  };

  const guard = new GuardPro({ redisUrl: 'redis://unit-statusless', redisClient: redis, budget: 1, windowSeconds: 60 });

  await guard.checkAndCharge('project-statusless', 0.01);
  await guard.checkAndCharge('project-statusless', 0.01);
  await guard.checkAndCharge('project-statusless', 0.01);

  assert.equal(connectCalls, 1);
  assert.equal(guard.isConnected(), true);
  assert.equal(await guard.getSpend('project-statusless'), 0.03);
});

test('GuardPro shares one connect attempt across concurrent callers', async () => {
  const redis = new StatuslessRedis();
  let connectCalls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  redis.connect = async () => {
    connectCalls += 1;
    await gate;
    redis.emit('ready');
  };

  const guard = new GuardPro({ redisUrl: 'redis://unit-connect-race', redisClient: redis, budget: 10, windowSeconds: 60 });

  const pending = Promise.all(
    Array.from({ length: 25 }, (_, index) => guard.checkAndCharge(`project-race-${index % 5}`, 0.01))
  );
  release();
  await pending;

  assert.equal(connectCalls, 1, 'concurrent callers must not each open a connection');
});

test('GuardPro does not reconnect inside the cooldown and recovers after it', async () => {
  const redis = new StatuslessRedis();
  let connectCalls = 0;
  redis.connect = async () => {
    connectCalls += 1;
    throw new Error('redis down');
  };

  const guard = new GuardPro({
    redisUrl: 'redis://unit-cooldown',
    redisClient: redis,
    budget: 1,
    windowSeconds: 60,
    reconnectCooldownMs: 60_000,
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await assert.rejects(
      () => guard.checkAndCharge('project-cooldown', 0.01),
      (error) => error instanceof GuardError && error.code === 'SHARED_BUDGET_UNAVAILABLE'
    );
  }

  assert.equal(connectCalls, 1, 'an outage must not be amplified into a connect storm');
  assert.equal(guard.isConnected(), false);

  redis.connect = async () => {
    connectCalls += 1;
    redis.emit('ready');
  };
  redis.failEval = false;

  const shortCooldown = new GuardPro({
    redisUrl: 'redis://unit-cooldown-recover',
    redisClient: redis,
    budget: 1,
    windowSeconds: 60,
    reconnectCooldownMs: 0,
  });
  await shortCooldown.checkAndCharge('project-cooldown', 0.01);
  assert.equal(connectCalls, 2, 'a new attempt is allowed once the cooldown is not blocking');
  assert.equal(shortCooldown.isConnected(), true);
});

test('GuardPro recovers shared enforcement after a transient command failure', async () => {
  const redis = new FakeRedis();
  redis.failEval = true;
  const guard = new GuardPro({
    redisUrl: 'redis://unit-recover',
    redisClient: redis,
    budget: 1,
    windowSeconds: 60,
    reconnectCooldownMs: 0,
  });

  await assert.rejects(
    () => guard.checkAndCharge('project-recover', 0.01),
    (error) => error instanceof GuardError && error.code === 'SHARED_BUDGET_UNAVAILABLE'
  );
  assert.equal(guard.isConnected(), false);

  redis.failEval = false;
  await guard.checkAndCharge('project-recover', 0.01);

  assert.equal(guard.isConnected(), true);
  assert.equal(await guard.getSpend('project-recover'), 0.01);
});

test('GuardPro rejects an invalid reconnectCooldownMs', () => {
  for (const reconnectCooldownMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => new GuardPro({ redisUrl: 'redis://unit', budget: 1, reconnectCooldownMs }),
      (error) => error instanceof GuardError && error.code === 'CONFIG_INVALID' && /reconnectCooldownMs/u.test(error.message)
    );
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

test('GuardPro stops reconnecting per request when a working client never reports ready', async () => {
  // A client can serve every command while its `status` stays non-ready, for instance when the
  // driver exposes a status the guard does not recognise. Every success cleared the cooldown via
  // markConnected(), so nothing stopped the next request from calling connect() again: one usable
  // socket turned into a connect attempt per guarded request.
  const redis = new FakeRedis();
  let connectCalls = 0;
  redis.connect = async () => {
    connectCalls += 1;
    redis.status = 'connecting';
  };

  const guard = new GuardPro({
    redisUrl: 'redis://unit-never-ready',
    redisClient: redis,
    budget: 10,
    windowSeconds: 60,
    reconnectCooldownMs: 60_000,
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await guard.checkAndCharge('project-never-ready', 0.01);
  }

  assert.equal(connectCalls, 1, 'a client that serves commands must not be reconnected per request');
  assert.equal(await guard.getSpend('project-never-ready'), 0.2);
});

test('GuardPro fails closed for every request when a non-ready client rejects commands', async () => {
  // The wedged case: connect() resolves, the client never reports ready, and commands throw. Each
  // request must fail closed without adding another connect attempt to the pile.
  const redis = new FakeRedis();
  let connectCalls = 0;
  redis.connect = async () => {
    connectCalls += 1;
    redis.status = 'connecting';
  };
  redis.eval = async () => {
    throw new Error('The client is closed');
  };

  const guard = new GuardPro({
    redisUrl: 'redis://unit-wedged',
    redisClient: redis,
    budget: 10,
    windowSeconds: 60,
    reconnectCooldownMs: 60_000,
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await assert.rejects(
      () => guard.checkAndCharge('project-wedged', 0.01),
      (error) => error instanceof GuardError && error.code === 'SHARED_BUDGET_UNAVAILABLE'
    );
  }

  assert.equal(connectCalls, 1, 'an outage must not be amplified into a connect attempt per request');
  assert.equal(guard.isConnected(), false);
});

test('GuardPro shutdown leaves a caller-supplied Redis client open', async () => {
  // The caller created this client and may share it with other guards. GuardPro used to quit it,
  // which broke every other holder of the same socket.
  const redis = new FakeRedis();
  const first = new GuardPro({ redisUrl: 'redis://unit-shared-client', redisClient: redis, budget: 1, windowSeconds: 60 });
  const second = new GuardPro({ redisUrl: 'redis://unit-shared-client', redisClient: redis, budget: 1, windowSeconds: 60 });

  await first.checkAndCharge('project-shared', 0.01);
  await first.shutdown();

  assert.equal(redis.status, 'ready', 'an injected client must not be closed by another holder shutting down');

  await second.checkAndCharge('project-shared', 0.01);
  assert.equal(await second.getSpend('project-shared'), 0.02);

  await second.shutdown();
  assert.equal(redis.status, 'ready', 'an injected client is closed by its owner, not by GuardPro');
});
