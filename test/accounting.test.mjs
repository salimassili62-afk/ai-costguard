import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guard, GuardError, DEFAULT_GUARDED_METHODS } from '@salimassili/ai-costguard';
import { GuardCore, createGuardState } from '../dist/esm/core/GuardCore.js';
import { daysAgo } from './helpers/dates.mjs';

/**
 * These tests exercise the accounting contract through the public `guard()` proxy so the real
 * pre-call path is under test: extract -> estimate -> budget test -> reserve -> provider call.
 *
 * Concurrency is real, not simulated. Every request goes through `Promise.all`, and the mock
 * provider awaits a macrotask before returning, so all reservations are committed while the first
 * provider call is still in flight. A check-then-reserve race would therefore show up as an extra
 * provider call.
 */

const OUTPUT_ONLY_PRICING = {
  model: 'test-output-only',
  inputPer1kTokens: 0,
  outputPer1kTokens: 0.6,
  lastUpdated: daysAgo(1),
  source: 'accounting-test',
};

/**
 * Builds a pricing entry where the estimated cost of a request is exactly
 * `outputTokens / 1000 * outputPer1kTokens`, independent of prompt length.
 */
function pricing(outputPer1kTokens, model = 'accounting-test-model') {
  return {
    model,
    inputPer1kTokens: 0,
    outputPer1kTokens,
    lastUpdated: daysAgo(1),
    source: 'accounting-test',
  };
}

/**
 * Mock provider that counts real executions and yields to the event loop before resolving, so
 * overlapping requests are genuinely in flight at the same time.
 */
function createMockProvider({ failWith } = {}) {
  const state = { calls: 0, inFlight: 0, maxInFlight: 0 };

  const client = {
    chat: {
      completions: {
        create: async (request) => {
          state.calls += 1;
          state.inFlight += 1;
          state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
          // Real await: the caller returns to the event loop here, which is where a broken
          // check-then-reserve design would let a second request slip past the budget.
          await new Promise((resolve) => setTimeout(resolve, 5));
          state.inFlight -= 1;
          if (failWith) throw failWith;
          return {
            id: `mock-${state.calls}`,
            usage: request.usage,
          };
        },
      },
    },
  };

  return { client, state };
}

function request(maxTokens, extra = {}) {
  return {
    model: 'accounting-test-model',
    messages: [{ role: 'user', content: `deterministic prompt ${maxTokens}` }],
    max_tokens: maxTokens,
    ...extra,
  };
}

/**
 * The guard blocks *synchronously*: `guarded.chat.completions.create(...)` throws before it ever
 * returns a promise, so a bare `Promise.allSettled([...])` would never observe a rejection.
 * Every concurrent scenario therefore goes through `settle`, which normalizes a synchronous throw
 * into a rejected promise so concurrency tests measure the guard, not the harness.
 */
function settle(thunk) {
  try {
    return Promise.resolve(thunk());
  } catch (error) {
    return Promise.reject(error);
  }
}

function runConcurrently(count, build) {
  return Promise.allSettled(Array.from({ length: count }, (_, index) => settle(() => build(index))));
}

function countAllowed(results) {
  return results.filter((result) => result.status === 'fulfilled').length;
}

function countBlocked(results) {
  return results.filter(
    (result) => result.status === 'rejected' && result.reason instanceof GuardError && result.reason.code === 'BUDGET_EXCEEDED'
  ).length;
}

function assertMoneyInvariant(state, budget) {
  assert.ok(
    Math.abs(state.attemptedCost - (state.reservedCost + state.blockedCost)) < 1e-12,
    `attemptedCost (${state.attemptedCost}) must equal reservedCost (${state.reservedCost}) + blockedCost (${state.blockedCost})`
  );
  assert.equal(state.totalCost, state.reservedCost, 'totalCost must stay an alias of reservedCost');
  assert.ok(state.reservedCost <= budget + 1e-12, `reservedCost ${state.reservedCost} must not exceed budget ${budget}`);
}

// ---------------------------------------------------------------------------------------------
// TEST A — budget $1.00, two concurrent requests estimated at $0.60 each
// ---------------------------------------------------------------------------------------------
test('TEST A: two concurrent $0.60 requests against a $1.00 budget send at most one to the provider', async () => {
  // Confirm the setup really produces a $0.60 pre-call estimate for this request shape.
  const probeCore = new GuardCore({ budget: 1, behaviorAnalysis: false, pricingOverrides: [pricing(0.6)] });
  const probed = probeCore.extractContext([request(1000)]);
  assert.equal(probed.estimatedCost, 0.6, 'test setup must produce the stated $0.60 estimate');

  const { client, state } = createMockProvider();
  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.6)],
  });

  const results = await runConcurrently(2, () => guarded.chat.completions.create(request(1000)));

  assert.equal(countAllowed(results), 1, 'exactly one request may be allowed');
  assert.equal(countBlocked(results), 1);
  assert.equal(state.calls, 1, 'at most one request may reach the provider');
  assert.equal(guarded.getGuardState().reservedCost, 0.6);
  assert.equal(guarded.getGuardState().blockedCost, 0.6);
  assertMoneyInvariant(guarded.getGuardState(), 1);
});

// ---------------------------------------------------------------------------------------------
// TEST B — budget $1.00, three concurrent requests estimated at $0.40 each
// ---------------------------------------------------------------------------------------------
test('TEST B: three concurrent $0.40 requests against a $1.00 budget send at most two to the provider', async () => {
  const { client, state } = createMockProvider();
  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.4)],
  });

  const results = await runConcurrently(3, () => guarded.chat.completions.create(request(1000)));

  assert.equal(countAllowed(results), 2, 'exactly two requests may be allowed');
  assert.equal(countBlocked(results), 1);
  assert.equal(state.calls, 2, 'at most two requests may reach the provider');
  assert.equal(guarded.getGuardState().reservedCost, 0.8);
  assert.ok(state.maxInFlight >= 1);
  assertMoneyInvariant(guarded.getGuardState(), 1);
});

// ---------------------------------------------------------------------------------------------
// TEST C — budget $1.00, two concurrent requests estimated at $0.50 each
// ---------------------------------------------------------------------------------------------
test('TEST C: three concurrent $0.10 requests against a $0.30 budget land on the ceiling without drift', async () => {
  // 0.1 + 0.1 + 0.1 is 0.30000000000000004 in IEEE-754. The guard rounds money to 6 decimal
  // places, so the third request must be *allowed*: it costs exactly the budget it was approved
  // against. A guard that compared unrounded floats would spuriously block here.
  const { client, state } = createMockProvider();
  const guarded = guard(client, {
    budget: 0.3,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.1)],
  });

  const results = await runConcurrently(3, () => guarded.chat.completions.create(request(1000)));

  assert.equal(countAllowed(results), 3, 'an exactly-affordable request is never blocked by float drift');
  assert.equal(state.calls, 3);
  assert.equal(guarded.getGuardState().reservedCost, 0.3, 'reserved cost must be exactly the budget, not 0.30000000000000004');
  assert.equal(guarded.getGuardState().blockedCost, 0);
  assertMoneyInvariant(guarded.getGuardState(), 0.3);
});

test('TEST C boundary: an estimate that lands exactly on the budget is allowed', async () => {
  const { client, state } = createMockProvider();
  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.5)],
  });

  // 2000 reserved output tokens at $0.50/1k is exactly the $1.00 budget: the ceiling is inclusive.
  const first = await guarded.chat.completions.create(request(2000));
  assert.ok(first.id);
  assert.equal(guarded.getGuardState().reservedCost, 1);

  const blocked = await settle(() => guarded.chat.completions.create(request(1))).then(
    () => null,
    (error) => error
  );
  assert.ok(blocked instanceof GuardError);
  assert.equal(blocked.code, 'BUDGET_EXCEEDED');
  assert.equal(state.calls, 1, 'an already-exhausted budget sends nothing more');
  assertMoneyInvariant(guarded.getGuardState(), 1);
});

// ---------------------------------------------------------------------------------------------
// TEST D — provider failure after a reservation
// ---------------------------------------------------------------------------------------------
test('TEST D: a provider failure keeps the reservation and records no refund', async () => {
  const { client, state } = createMockProvider({ failWith: new Error('provider 503') });
  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.6)],
  });

  const failure = await guarded.chat.completions.create(request(1000)).then(
    () => null,
    (error) => error
  );

  assert.equal(failure?.message, 'provider 503');
  assert.equal(state.calls, 1, 'the failed request did reach the provider');

  const after = guarded.getGuardState();
  // Conservative documented behavior: the guard cannot prove the failed request created no
  // billable operation, so the reservation is kept.
  assert.equal(after.reservedCost, 0.6, 'a failed provider call must keep its reservation');
  assert.equal(after.totalCost, 0.6);
  assert.equal(after.attemptedCost, 0.6);
  assert.equal(after.blockedCost, 0, 'a provider failure is not a block');
  assert.equal(after.blockedCount, 0);
  assert.equal(after.actualCost, 0, 'no provider usage was reported, so there is no actual cost');
  assert.equal(after.requestCount, 1);
  assertMoneyInvariant(after, 1);
});

// ---------------------------------------------------------------------------------------------
// TEST E — estimate $0.40, recognizable provider usage $0.10
// ---------------------------------------------------------------------------------------------
test('TEST E: recognized usage records actual cost without rewriting the reservation or the allow decision', async () => {
  const { client } = createMockProvider();
  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.1)],
  });

  const usageEvents = [];
  guarded.on('usage', (event) => usageEvents.push(event));

  // 4000 reserved output tokens at $0.10/1k = $0.40 estimated.
  await guarded.chat.completions.create(request(4000, { usage: { prompt_tokens: 0, completion_tokens: 1000 } }));

  const after = guarded.getGuardState();
  assert.equal(after.reservedCost, 0.4, 'the reservation is the budget value and must not shrink');
  assert.equal(after.actualCost, 0.1, 'provider-reported usage is recorded as an upper bound on real usage');
  assert.equal(after.totalCost, 0.4);
  assert.equal(after.blockedCost, 0);
  assert.equal(after.requestCount, 1);
  assertMoneyInvariant(after, 1);

  assert.equal(usageEvents.length, 1);
  assert.equal(usageEvents[0].context.usageStatus, 'reported');
  assert.equal(usageEvents[0].context.estimatedCost, 0.4);
  assert.equal(usageEvents[0].context.actualCost, 0.1);
});

// ---------------------------------------------------------------------------------------------
// TEST F — provider succeeds but recognizable usage is unavailable
// ---------------------------------------------------------------------------------------------
test('TEST F: a successful call with no recognizable usage reports status unavailable and keeps the reservation', async () => {
  const { client } = createMockProvider();
  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.6)],
  });

  const usageEvents = [];
  guarded.on('usage', (event) => usageEvents.push(event));

  await guarded.chat.completions.create(request(1000));

  const after = guarded.getGuardState();
  assert.equal(after.actualCost, 0, 'no usage means no actual cost is invented');
  assert.equal(after.reservedCost, 0.6, 'the reservation stands as the only cost signal');
  assert.equal(usageEvents.length, 1, 'reconciliation is still reported, so silence is not mistaken for a bug');
  assert.equal(usageEvents[0].context.usageStatus, 'unavailable');
  assert.equal(usageEvents[0].context.actualCost, undefined);
  assert.equal(usageEvents[0].context.usageReported, undefined);
  assertMoneyInvariant(after, 1);
});

test('TEST F partial: one-sided provider usage falls back to the estimate and is flagged', async () => {
  const { client } = createMockProvider();
  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.1)],
  });

  const usageEvents = [];
  guarded.on('usage', (event) => usageEvents.push(event));

  // Only prompt_tokens present. Output falls back to the reserved 4000 tokens.
  await guarded.chat.completions.create(request(4000, { usage: { prompt_tokens: 10 } }));

  const after = guarded.getGuardState();
  assert.equal(usageEvents[0].context.usageStatus, 'partial');
  assert.equal(usageEvents[0].context.usagePartial, true);
  assert.ok(after.actualCost > 0, 'the fallback still produces a documented upper bound');
  assert.equal(after.reservedCost, 0.4, 'the fallback never becomes the budget value');
});

// ---------------------------------------------------------------------------------------------
// TEST G — retry after a failed request
// ---------------------------------------------------------------------------------------------
test('TEST G: retrying a failed request cannot punch through the budget', async () => {
  const { client, state } = createMockProvider({ failWith: new Error('provider 503') });
  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.6)],
  });

  const first = await settle(() => guarded.chat.completions.create(request(1000))).then(
    () => 'allowed',
    () => 'failed'
  );
  assert.equal(first, 'failed');

  const retry = await settle(() => guarded.chat.completions.create(request(1000))).then(
    () => 'allowed',
    (error) => error
  );

  assert.ok(retry instanceof GuardError, 'the retry must be blocked');
  assert.equal(retry.code, 'BUDGET_EXCEEDED');
  assert.equal(state.calls, 1, 'the retry must never reach the provider');
  assert.equal(guarded.getGuardState().reservedCost, 0.6);
  assert.equal(guarded.getGuardState().blockedCost, 0.6);
  assertMoneyInvariant(guarded.getGuardState(), 1);
});

// ---------------------------------------------------------------------------------------------
// TEST H — multiple scopes under concurrent load
// ---------------------------------------------------------------------------------------------
test('TEST H: concurrent scopes keep separate budgets and do not corrupt each other', async () => {
  const { client, state } = createMockProvider();
  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.6)],
  });

  const scopes = ['tenant-a', 'tenant-b', 'tenant-c'];
  // A scope is (projectId, userId, sessionId, runId). Both requests in a scope therefore carry the
  // same sessionId AND the same runId; only sessionId varies between scopes.
  const results = await Promise.allSettled(
    scopes.flatMap((sessionId) => [
      settle(() => guarded.chat.completions.create(request(1000, { sessionId, runId: 'run-1' }))),
      settle(() => guarded.chat.completions.create(request(1000, { sessionId, runId: 'run-1' }))),
    ])
  );

  assert.equal(countAllowed(results), 3, 'each of the three scopes allows exactly one request');
  assert.equal(countBlocked(results), 3);
  assert.equal(state.calls, 3, 'exactly one provider call per scope');
  assert.equal(state.maxInFlight, 3, 'all three scopes really were in flight together');

  const scopeState = guarded.getGuardState().scopes;
  assert.equal(Object.keys(scopeState).length, 3);
  for (const sessionId of scopes) {
    const key = JSON.stringify([null, null, sessionId, 'run-1']);
    const matching = scopeState[key];
    assert.ok(matching, `expected state for ${key}`);
    assert.equal(matching.reservedCost, 0.6);
    assert.equal(matching.blockedCost, 0.6, 'the blocked sibling was charged to this same scope');
    assert.equal(matching.requestCount, 1);
    assert.equal(matching.blockedCount, 1);
    assertMoneyInvariant(matching, 1);
  }

  // The blocked request must be attributed to the scope that rejected it, not to a neighbour.
  for (const sessionId of scopes) {
    const key = JSON.stringify([null, null, sessionId, 'run-1']);
    assert.equal(scopeState[key].attemptedCost, 1.2);
  }
});

// ---------------------------------------------------------------------------------------------
// Accounting invariants that must hold for any interleaving
// ---------------------------------------------------------------------------------------------
test('a caller-supplied scopeKey can never resolve to an inherited property', () => {
  // `context.scopeKey` is caller-supplied whenever the guard is driven through `middleware()`. If
  // the scope map were read with a plain property access, a key like `__proto__` would return
  // `Object.prototype` itself, and the guard would write budget balances, loop history, and
  // counters onto it: corrupting every object in the process and pooling unrelated callers into a
  // single budget bucket.
  const inherited = Object.getOwnPropertyNames(Object.prototype);
  const prototypeKeys = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'];

  for (const scopeKey of prototypeKeys) {
    const core = new GuardCore({
      budget: 0.002,
      behaviorAnalysis: false,
      maxScopes: 10,
      pricingOverrides: [pricing(0.2, `scope-key-test-${scopeKey}`)],
    });

    const context = {
      model: 'gpt-4o-mini',
      pricingKnown: true,
      tokens: 1000,
      outputTokens: 1000,
      estimatedCost: 0.0001,
      timestamp: Date.now(),
      prompt: `distinct prompt for ${scopeKey}`,
      scopeKey,
    };

    assert.equal(core.check(context).decision, 'allow', `scopeKey "${scopeKey}" must be a normal budgeted scope`);

    const state = core.getState();
    assert.equal(
      Object.keys(state.scopes).length,
      1,
      `scopeKey "${scopeKey}" must be tracked as a real scope, not resolved through the prototype chain`
    );
    assert.equal(state.scopes[scopeKey].reservedCost, 0.0001, `scopeKey "${scopeKey}" must hold its own reservation`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(state.scopes, scopeKey),
      `scopeKey "${scopeKey}" must be an own property of the scope map`
    );
  }

  assert.deepEqual(
    Object.getOwnPropertyNames(Object.prototype),
    inherited,
    'the guard must not add or remove any property on Object.prototype'
  );
  assert.equal({}.reservedCost, undefined, 'plain objects must not inherit guard accounting fields');
  assert.equal(Array.isArray({}.recentPrompts), false, 'plain objects must not inherit a shared prompt history array');
});

test('a prototype-named scope is still bounded by maxScopes and by its own budget', () => {
  const core = new GuardCore({
    budget: 0.002,
    behaviorAnalysis: false,
    maxScopes: 1,
    pricingOverrides: [pricing(0.2, 'scope-limit-test-model')],
  });

  const request = (scopeKey, prompt) => ({
    model: 'gpt-4o-mini',
    pricingKnown: true,
    tokens: 1000,
    outputTokens: 1000,
    estimatedCost: 0.0001,
    timestamp: Date.now(),
    prompt,
    scopeKey,
  });

  assert.equal(core.check(request('__proto__', 'first prompt here')).decision, 'allow');

  // A second distinct key cannot fit inside maxScopes: 1, so the limit must still apply.
  assert.throws(
    () => core.check(request('toString', 'second prompt here')),
    (error) => error instanceof GuardError && error.code === 'SCOPE_LIMIT_EXCEEDED',
    'maxScopes must count prototype-named keys, otherwise the limit is bypassed'
  );

  // The first request already reserved $0.0001 of the $0.002 budget, so 19 more of the $0.0001
  // requests fit and every request after that must be blocked.
  let allowed = 0;
  for (let i = 0; i < 50; i += 1) {
    try {
      core.check(request('__proto__', `loop prompt ${i} distinct ${i}`));
      allowed += 1;
    } catch (error) {
      assert.ok(error instanceof GuardError);
      assert.equal(error.code, 'BUDGET_EXCEEDED');
    }
  }
  assert.equal(allowed, 19, 'a prototype-named scope must enforce its budget like any other scope');
  assert.equal(core.getState().reservedCost, 0.002, 'the budget ceiling is inclusive and must not be overshot');
  assertMoneyInvariant(core.getState(), 0.002);
});

test('a high-contention burst never overshoots and always satisfies the accounting invariant', async () => {
  const { client, state } = createMockProvider();
  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    pricingOverrides: [pricing(0.05)],
  });

  // 40 concurrent requests at $0.05 each against a $1.00 budget in ONE scope: exactly 20 may run.
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, () => settle(() => guarded.chat.completions.create(request(1000))))
  );

  assert.equal(countAllowed(results), 20);
  assert.equal(state.calls, 20, 'the provider must see exactly 20 calls, never 21');
  assert.equal(guarded.getGuardState().reservedCost, 1);
  assertMoneyInvariant(guarded.getGuardState(), 1);
});

test('guards sharing one GuardState share the reservation pool and cannot double-spend', async () => {
  const { client: clientA, state: stateA } = createMockProvider();
  const { client: clientB, state: stateB } = createMockProvider();
  const sharedState = createGuardState();

  // `sharedState` is the third positional argument of guard(), not a config key: two independent
  // clients backed by one state must contend for one reservation pool.
  const config = { budget: 1, behaviorAnalysis: false, pricingOverrides: [pricing(0.6)] };
  const guardedA = guard(clientA, config, sharedState);
  const guardedB = guard(clientB, config, sharedState);

  const results = await Promise.allSettled([
    settle(() => guardedA.chat.completions.create(request(1000, { runId: 'shared-1' }))),
    settle(() => guardedB.chat.completions.create(request(1000, { runId: 'shared-1' }))),
  ]);

  assert.equal(countAllowed(results), 1);
  assert.equal(stateA.calls + stateB.calls, 1, 'a shared reservation pool admits one call, not two');
  assert.equal(guardedA.getGuardState().reservedCost, 0.6);
  assert.equal(guardedB.getGuardState(), guardedA.getGuardState(), 'both guards observe the same state object');
  assertMoneyInvariant(sharedState.scopes[JSON.stringify([null, null, null, 'shared-1'])], 1);
});

test('the core evaluator holds the same atomicity contract without a client proxy', async () => {
  const core = new GuardCore({ budget: 1, behaviorAnalysis: false, pricingOverrides: [pricing(0.4)] });
  const contexts = [1, 2, 3, 4, 5].map((index) => ({
    model: 'accounting-test-model',
    pricingKnown: true,
    tokens: 1000,
    outputTokens: 1000,
    estimatedCost: 0.4,
    timestamp: Date.now(),
    prompt: `core request ${index}`,
    scopeKey: 'shared',
  }));

  // Interleave the callers exactly the way concurrent promise callbacks would.
  let allowed = 0;
  for (const context of contexts) {
    try {
      if (core.check(context).decision === 'allow') allowed += 1;
    } catch (error) {
      assert.ok(error instanceof GuardError, 'the core only ever throws GuardError');
      assert.equal(error.code, 'BUDGET_EXCEEDED');
    }
  }

  assert.equal(allowed, 2, 'five sequential commits against a $1.00 budget at $0.40 each admit two');
  assert.equal(core.getState().reservedCost, 0.8);
  assertMoneyInvariant(core.getState(), 1);
});

// ---------------------------------------------------------------------------------------------
// Guard coverage boundaries
// ---------------------------------------------------------------------------------------------
test('unguarded client methods are passed through and are not costed', async () => {
  let providerCalls = 0;
  const client = {
    chat: {
      completions: { create: async () => { providerCalls += 1; return {}; } },
      // A sibling namespace that is deliberately not in the default guarded list.
      audio: { transcriptions: { create: async () => { providerCalls += 1; return {}; } } },
    },
    // A raw fetch is not intercepted at all.
    rawFetch: async () => { providerCalls += 1; return {}; },
  };

  const guarded = guard(client, { budget: 0.000001, behaviorAnalysis: false });

  await guarded.chat.audio.transcriptions.create({ model: 'whisper-1', model_hint: 'no pricing needed here' });
  await guarded.rawFetch('https://example.invalid/v1/chat/completions', { method: 'POST' });

  assert.equal(providerCalls, 2, 'bypassed methods are the documented boundary, not a silent block');
  assert.equal(guarded.getGuardState().reservedCost, 0, 'bypassed calls are never charged to the budget');
  assert.equal(guarded.getGuardState().requestCount, 0);
});

test('a custom guardedMethods entry is costed and everything else on the client is not', async () => {
  let providerCalls = 0;
  const client = {
    agent: {
      run: async () => { providerCalls += 1; return { usage: { input_tokens: 1, output_tokens: 1 } }; },
      preview: async () => { providerCalls += 1; return {}; },
    },
  };

  const guarded = guard(client, {
    budget: 1,
    behaviorAnalysis: false,
    guardedMethods: ['agent.run'],
    pricingOverrides: [pricing(0.6)],
  });

  await guarded.agent.preview({ model: 'accounting-test-model' });
  assert.equal(guarded.getGuardState().reservedCost, 0, 'agent.preview is outside guardedMethods');

  await guarded.agent.run({ model: 'accounting-test-model', messages: [{ role: 'user', content: 'run' }], max_tokens: 1000 });
  assert.equal(providerCalls, 2);
  assert.equal(guarded.getGuardState().reservedCost, 0.6, 'a custom guardedMethods entry is costed like a default one');
});

test('the default guarded method list is exported so coverage is inspectable', () => {
  assert.deepEqual([...DEFAULT_GUARDED_METHODS], [
    'chat.completions.create',
    'completions.create',
    'responses.create',
    'messages.create',
  ]);
});
