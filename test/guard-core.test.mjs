import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GuardCore, GuardError } from '../dist/esm/core/GuardCore.js';
import { cosineSimilarity } from '../dist/esm/core/similarity.js';
import { estimateTokensForModel, estimateTokensFromText, estimateRequestTokens } from '../dist/esm/core/tokenizer.js';
import { registerTokenizer } from '../dist/esm/index.js';
import { daysAgo } from './helpers/dates.mjs';

test('token estimator calibrates normal English without extreme overestimation', () => {
  const estimate = estimateTokensForModel('gpt-4o-mini', 'Summarize this support ticket in two bullets.');

  assert.equal(estimate.approximate, true);
  assert.ok(estimate.tokens >= 8);
  assert.ok(estimate.tokens <= 12);

  const request = estimateRequestTokens({
    messages: [{ role: 'user', content: 'hello world' }],
    max_tokens: 10,
  });

  assert.equal(request.outputTokens, 10);
  assert.ok(request.inputTokens > 3);
  assert.equal(request.tokens, request.inputTokens + 10);
});

test('token estimator reserves every billed candidate and every billed prompt', () => {
  const single = estimateRequestTokens({
    messages: [{ role: 'user', content: 'hello world' }],
    max_tokens: 100,
  });
  const fourChoices = estimateRequestTokens({
    messages: [{ role: 'user', content: 'hello world' }],
    max_tokens: 100,
    n: 4,
  });

  assert.equal(single.candidateCount, 1);
  assert.equal(single.promptCount, 1);
  assert.equal(single.outputTokensPerCandidate, 100);
  assert.equal(single.outputTokens, 100);

  assert.equal(fourChoices.candidateCount, 4);
  assert.equal(fourChoices.outputTokensPerCandidate, 100);
  assert.equal(fourChoices.outputTokens, 400);
  assert.equal(fourChoices.inputTokens, single.inputTokens, 'input is billed once for n>1');
  assert.equal(fourChoices.tokens, fourChoices.inputTokens + 400);

  const batched = estimateRequestTokens({
    model: 'gpt-3.5-turbo-instruct',
    prompt: ['first prompt', 'second prompt', 'third prompt'],
    max_tokens: 50,
  });
  assert.equal(batched.promptCount, 3);
  assert.ok(batched.inputTokens > single.inputTokens, 'a prompt array is billed once per prompt');

  const conversation = estimateRequestTokens({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }],
    max_tokens: 10,
  });
  assert.equal(conversation.promptCount, 1, 'a message array is one conversation, not a batch');

  const responsesInput = estimateRequestTokens({ model: 'gpt-4o-mini', input: [{ role: 'user', content: 'a' }], max_tokens: 10 });
  assert.equal(responsesInput.promptCount, 1);
});

test('token estimator ignores unbilled candidate controls and clamps absurd counts', () => {
  const bestOf = estimateRequestTokens({
    messages: [{ role: 'user', content: 'hello world' }],
    max_tokens: 100,
    best_of: 8,
  });
  assert.equal(bestOf.candidateCount, 1, 'legacy best_of is not billed');
  assert.equal(bestOf.outputTokens, 100);

  for (const [n, expected] of [[0, 1], [-3, 1], [2.4, 3], [5_000, 1_000]]) {
    const estimate = estimateRequestTokens({ messages: [{ role: 'user', content: 'x' }], max_tokens: 10, n });
    assert.equal(estimate.candidateCount, expected);
  }
});

test('GuardCore charges every candidate, including the default output reservation', () => {
  const core = new GuardCore({ budget: 1 });
  const base = core.extractContext([{ model: 'gpt-4o-mini', prompt: 'pick one', max_tokens: 1_000 }]);
  const batched = core.extractContext([{ model: 'gpt-4o-mini', prompt: 'pick one', max_tokens: 1_000, n: 5 }]);

  assert.equal(base.outputTokens, 1_000);
  assert.equal(batched.outputTokens, 5_000);
  assert.equal(batched.candidateCount, 5);
  assert.ok(
    Math.abs(batched.estimatedCost - base.estimatedCost * 5 + (base.inputTokens / 1000) * 4 * 0.00015) < 1e-12,
    `unexpected cost scaling: ${batched.estimatedCost} vs ${base.estimatedCost}`
  );

  const defaulted = new GuardCore({ budget: 1, defaultOutputTokens: 200 });
  const defaultedContext = defaulted.extractContext([{ model: 'gpt-4o-mini', prompt: 'pick one', n: 3 }]);
  assert.equal(defaultedContext.outputTokensSource, 'default');
  assert.equal(defaultedContext.outputTokens, 600);
});

test('GuardCore allows a charge that lands exactly on a float-derived budget', () => {
  // `checkBudget` compares in integer micro-dollars so that a budget the caller derived by float
  // arithmetic cannot reject a call that costs exactly that budget. The request below costs
  // 0.012006000000000001 as a float, so `perCall * 2` is one ULP above the 0.012006 micro-dollar grid
  // the accumulated total lands on; comparing the raw floats blocks the second charge. This also
  // keeps the in-process decision identical to the shared Redis path, which allows `projected >
  // budget` only when the integer values differ.
  //
  // The price is pinned through `pricingOverrides` rather than read from the built-in registry: this
  // test is about float behaviour in `checkBudget`, so it must not start failing the next time a
  // verified registry price changes.
  const PRICING_OVERRIDES = [
    {
      model: 'float-drift-unit-model',
      inputPer1kTokens: 0.003,
      outputPer1kTokens: 0.003,
      lastUpdated: daysAgo(1),
      source: 'unit-test',
    },
  ];
  const call = (core) =>
    core.extractContext([{ model: 'float-drift-unit-model', prompt: 'x', max_tokens: 4000 }]);

  const probe = new GuardCore({ budget: 1, pricingOverrides: PRICING_OVERRIDES });
  const perCall = call(probe).estimatedCost;
  // The point of the test is that `perCall * 2` is not the same float as the accumulated total, so
  // assert the premise holds rather than hardcoding a literal.
  const accumulated = (Math.round(perCall * 1_000_000) + Math.round(perCall * 1_000_000)) / 1_000_000;
  assert.notEqual(perCall * 2, accumulated, 'expected a float-artefact premise to hold');

  const core = new GuardCore({ budget: perCall * 2, pricingOverrides: PRICING_OVERRIDES });
  core.check(call(core));
  assert.doesNotThrow(() => core.check(call(core)), 'the second charge lands exactly on the budget');

  // One micro-dollar beyond the budget is still refused, so the comparison did not simply widen.
  const tight = new GuardCore({
    budget: perCall * 2 - 0.000001,
    pricingOverrides: PRICING_OVERRIDES,
  });
  tight.check(call(tight));
  assert.throws(
    () => tight.check(call(tight)),
    (error) => error.code === 'BUDGET_EXCEEDED',
    'a charge one micro-dollar over the budget must still be blocked'
  );
});

test('GuardCore blocks a batched request that a per-candidate estimate would have allowed', () => {
  const core = new GuardCore({ budget: 0.001 });
  const message = { role: 'user', content: 'summarize this ticket' };

  core.check(core.extractContext([{ model: 'gpt-4o-mini', messages: [message], max_tokens: 1_000 }]));

  const batched = new GuardCore({ budget: 0.001 });
  assert.throws(
    () => batched.check(batched.extractContext([{ model: 'gpt-4o-mini', messages: [message], max_tokens: 1_000, n: 4 }])),
    (error) => error instanceof GuardError && error.code === 'BUDGET_EXCEEDED'
  );
});

test('token estimator calibrates code, structured payloads, Claude-family, and unknown models', () => {
  const code = estimateTokensForModel(
    'gpt-4o-mini',
    'function normalizeUser(user) { return { id: user.id, email: user.email?.toLowerCase() }; }'
  );
  const json = estimateTokensForModel(
    'gpt-4o-mini',
    '{"model":"gpt-4o-mini","max_tokens":400,"tools":[{"name":"search","strict":true}]}'
  );
  const claude = estimateTokensForModel(
    'claude-sonnet-4-5',
    'Claude should inspect the document, call the classifier once, and stop if confidence is below 0.7.'
  );
  const gptForSameText = estimateTokensForModel(
    'gpt-4o-mini',
    'Claude should inspect the document, call the classifier once, and stop if confidence is below 0.7.'
  );
  const unknown = estimateTokensForModel(undefined, 'Summarize this ticket.');

  assert.ok(code.tokens >= 20 && code.tokens <= 30);
  assert.ok(json.tokens >= 20 && json.tokens <= 30);
  assert.ok(claude.tokens > gptForSameText.tokens);
  assert.equal(unknown.tokens, estimateTokensFromText('Summarize this ticket.'));
});

test('registered tokenizers override prompt token estimation by model string pattern', () => {
  registerTokenizer('unit-tokenizer-string', () => 7);

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));

  try {
    const core = new GuardCore({
      budget: 1,
      pricingOverrides: [
        {
          model: 'unit-tokenizer-string-model',
          inputPer1kTokens: 1,
          outputPer1kTokens: 0,
          lastUpdated: daysAgo(1),
          source: 'unit-test',
        },
      ],
    });
    const context = core.extractContext([{ model: 'unit-tokenizer-string-model', prompt: 'hello world', max_tokens: 3 }]);

    assert.equal(context.inputTokens, 7);
    assert.equal(context.outputTokens, 3);
    assert.equal(context.tokens, 10);
    assert.equal(context.approximateTokens, false);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 0);
});

test('registered tokenizers support RegExp model patterns', () => {
  registerTokenizer(/^unit-tokenizer-regex-/u, (text) => text.split(/\s+/u).filter(Boolean).length);

  const core = new GuardCore({
    budget: 1,
    pricingOverrides: [
      {
        model: 'unit-tokenizer-regex-model',
        inputPer1kTokens: 1,
        outputPer1kTokens: 0,
        lastUpdated: daysAgo(1),
        source: 'unit-test',
      },
    ],
  });
  const context = core.extractContext([
    { model: 'unit-tokenizer-regex-model', prompt: 'count these four words', max_tokens: 1 },
  ]);

  assert.equal(context.inputTokens, 4);
  assert.equal(context.approximateTokens, false);
});

test('tokenizer errors fall back to approximate counting with one warning per model and scope', () => {
  registerTokenizer('unit-tokenizer-throws', () => {
    throw new Error('tokenizer unavailable');
  });

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));

  try {
    const core = new GuardCore({
      budget: 1,
      pricingOverrides: [
        {
          model: 'unit-tokenizer-throws-model',
          inputPer1kTokens: 1,
          outputPer1kTokens: 0,
          lastUpdated: daysAgo(1),
          source: 'unit-test',
        },
      ],
    });

    const args = [{ model: 'unit-tokenizer-throws-model', prompt: 'fallback prompt', max_tokens: 1 }];
    const first = core.extractContext(args);
    const second = core.extractContext(args);

    assert.equal(first.approximateTokens, true);
    assert.equal(second.approximateTokens, true);
    assert.ok(first.inputTokens > 0);

    // A different scope for the same model must warn again: the dedupe key is model + scope.
    const otherScope = core.extractContext([
      { model: 'unit-tokenizer-throws-model', prompt: 'fallback prompt', max_tokens: 1, sessionId: 'other' },
    ]);
    assert.equal(otherScope.approximateTokens, true);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 2, 'exactly one warning per model+scope, and no other warning noise');
  assert.match(
    warnings[0],
    /^\[ai-costguard\] Using approximate token counting for model: unit-tokenizer-throws-model/
  );
});

test('cosine similarity catches near-duplicate prompts with character trigrams', () => {
  const score = cosineSimilarity('retry fetching invoice data from the API', 'retry fetching invoice data from api');
  assert.ok(score >= 0.85, `expected score >= 0.85, received ${score}`);
});

test('GuardCore emits cost and allow events for an allowed request', () => {
  const core = new GuardCore({ budget: 1 });
  const events = [];

  core.on('cost', (event) => events.push(event.type));
  core.on('allow', (event) => events.push(event.type));

  const result = core.check({
    model: 'gpt-4o-mini',
    pricingKnown: true,
    tokens: 10,
    inputTokens: 5,
    outputTokens: 5,
    estimatedCost: 0.00001,
    timestamp: Date.now(),
    prompt: 'unique one',
  });

  assert.equal(result.decision, 'allow');
  assert.deepEqual(events, ['cost', 'allow']);
  assert.equal(core.getState().requestCount, 1);
  assert.equal(core.getState().attemptedCost, 0.00001);
  assert.equal(core.getState().reservedCost, core.getState().totalCost);
});

test('GuardCore blocks similar prompt loops after repeated scoped matches', () => {
  const core = new GuardCore({ budget: 1, loopSimilarityThreshold: 0.85 });

  const first = {
    model: 'gpt-4o-mini',
    pricingKnown: true,
    tokens: 10,
    estimatedCost: 0.00001,
    timestamp: Date.now(),
    prompt: 'summarize the quarterly incident report',
    scope: { sessionId: 'a' },
    scopeKey: 'session:a',
  };

  core.check(first);
  core.check({ ...first, prompt: 'summarize the quarterly incident report' });

  assert.throws(
    () =>
      core.check({
        ...first,
        timestamp: Date.now(),
        prompt: 'summarize the quarterly incident report',
      }),
    (error) => error instanceof GuardError && error.code === 'LOOP_DETECTED'
  );
  assert.equal(core.getState().blockedCount, 1);
});

test('GuardCore loopDetection config changes threshold, minimum matches, and window size', () => {
  const base = {
    model: 'gpt-4o-mini',
    pricingKnown: true,
    tokens: 10,
    estimatedCost: 0.00001,
    timestamp: Date.now(),
  };

  const strictCore = new GuardCore({
    budget: 1,
    loopDetection: { similarityThreshold: 1, minHistorySize: 1, windowSize: 5 },
  });
  strictCore.check({ ...base, prompt: 'summarize the quarterly incident report' });
  assert.doesNotThrow(() =>
    strictCore.check({ ...base, prompt: 'summarize the quarterly incident report for legal review' })
  );
  assert.throws(
    () => strictCore.check({ ...base, prompt: 'summarize the quarterly incident report' }),
    (error) => error instanceof GuardError && error.code === 'LOOP_DETECTED'
  );

  const windowCore = new GuardCore({
    budget: 1,
    loopDetection: { similarityThreshold: 0.99, minHistorySize: 1, windowSize: 1 },
  });
  windowCore.check({ ...base, prompt: 'draft an invoice risk summary for account alpha' });
  windowCore.check({ ...base, prompt: 'translate a short French launch note into English' });
  assert.doesNotThrow(() =>
    windowCore.check({ ...base, prompt: 'draft an invoice risk summary for account alpha' })
  );
});

test('GuardCore validates structured loopDetection config', () => {
  assert.throws(
    () => new GuardCore({ loopDetection: { similarityThreshold: 1.1 } }),
    /loopDetection\.similarityThreshold must be between 0 and 1/
  );
  assert.throws(
    () => new GuardCore({ loopDetection: { minHistorySize: 0 } }),
    /loopDetection\.minHistorySize must be at least 1/
  );
  assert.throws(
    () => new GuardCore({ loopDetection: { windowSize: 0 } }),
    /loopDetection\.windowSize must be at least 1/
  );
});

test('GuardCore rejects invalid maxHistory configuration', () => {
  for (const maxHistory of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => new GuardCore({ maxHistory }),
      (error) => error instanceof GuardError && error.code === 'CONFIG_INVALID' && /maxHistory/u.test(error.message)
    );
  }
});

test('GuardCore rejects invalid contexts instead of converting safety values to zero', () => {
  const core = new GuardCore({ budget: 1 });

  assert.throws(
    () => core.check({ model: 'gpt-4o-mini', tokens: Number.NaN, estimatedCost: 0, timestamp: Date.now(), prompt: 'bad' }),
    (error) => error instanceof GuardError && error.code === 'CONTEXT_INVALID'
  );
  assert.throws(
    () => core.check({ model: 'gpt-4o-mini', tokens: 1, estimatedCost: 0, timestamp: Date.now(), prompt: 'bad' }),
    (error) => error instanceof GuardError && error.code === 'CONTEXT_INVALID'
  );
});

test('GuardCore blocks streaming before provider execution and reconciles usage once', () => {
  const core = new GuardCore({ budget: 1 });
  const streaming = core.extractContext([{ model: 'gpt-4o-mini', prompt: 'stream', max_tokens: 10, stream: true }]);

  assert.equal(streaming.streaming, true);
  assert.throws(() => core.check(streaming), (error) => error instanceof GuardError && error.code === 'STREAMING_UNSUPPORTED');

  const context = core.extractContext([{ model: 'gpt-4o-mini', prompt: 'once', max_tokens: 10 }]);
  core.check(context);
  core.recordActualUsage(context, { usage: { prompt_tokens: 12, completion_tokens: 4 } });
  core.recordActualUsage(context, { usage: { prompt_tokens: 1200, completion_tokens: 400 } });
  assert.equal(core.getState().actualCost, context.actualCost);
});

test('GuardCore blocks retry storms and max step overflow', () => {
  const retryCore = new GuardCore({ budget: 1, retryThreshold: 2 });
  const makeRetry = (prompt) => ({
    model: 'gpt-4o-mini',
    pricingKnown: true,
    tokens: 10,
    estimatedCost: 0.00001,
    timestamp: Date.now(),
    prompt,
  });

  retryCore.check(makeRetry('retry failed request for account A'));
  retryCore.check(makeRetry('again after timeout for account B'));
  assert.throws(
    () => retryCore.check(makeRetry('repeat after error for account C')),
    (error) => error instanceof GuardError && error.code === 'RETRY_STORM_DETECTED'
  );

  const stepCore = new GuardCore({ budget: 1, maxSteps: 1 });
  stepCore.check(makeRetry('first unique prompt'));
  assert.throws(
    () => stepCore.check(makeRetry('second unique prompt')),
    (error) => error instanceof GuardError && error.code === 'MAX_STEPS_EXCEEDED'
  );
});

test('GuardCore blocks unknown models unless fallback pricing is configured', () => {
  const core = new GuardCore({ budget: 1 });
  const context = core.extractContext([
    {
      model: 'private-model',
      prompt: 'hello',
      max_tokens: 5,
    },
  ]);

  assert.equal(context.pricingKnown, false);
  assert.throws(() => core.check(context), (error) => error instanceof GuardError && error.code === 'UNKNOWN_MODEL');

  const fallbackCore = new GuardCore({
    budget: 1,
    unknownModelPolicy: 'fallback',
    unknownModelPricing: {
      model: 'private-model',
      inputPer1kTokens: 0.001,
      outputPer1kTokens: 0.002,
      lastUpdated: daysAgo(1),
      source: 'unit-test',
    },
  });

  const fallback = fallbackCore.extractContext([{ model: 'private-model', prompt: 'hello', max_tokens: 5 }]);
  assert.equal(fallback.pricingKnown, true);
  assert.equal(fallbackCore.check(fallback).decision, 'allow');
});

test('GuardCore rejects cost overflow instead of converting it to zero', () => {
  const core = new GuardCore({
    budget: 1,
    pricingOverrides: [
      {
        model: 'overflow-model',
        inputPer1kTokens: Number.MAX_VALUE,
        outputPer1kTokens: Number.MAX_VALUE,
        lastUpdated: daysAgo(1),
        source: 'unit-test',
      },
    ],
  });

  assert.throws(
    () => core.extractContext([{ model: 'overflow-model', prompt: 'overflow', max_tokens: Number.MAX_VALUE }]),
    (error) => error instanceof GuardError && error.code === 'CONTEXT_INVALID'
  );
});

test('GuardCore rejects requests without an explicit output limit', () => {
  const core = new GuardCore({ budget: 1 });
  assert.throws(
    () => core.extractContext([{ model: 'gpt-4o-mini', prompt: 'missing output limit' }]),
    (error) => error instanceof GuardError && error.code === 'OUTPUT_LIMIT_REQUIRED'
  );
});

test('GuardCore isolates behavior history by scope and prunes expired history', () => {
  const core = new GuardCore({ budget: 1, historyTtlMs: 1, loopSimilarityThreshold: 0.85 });
  const base = {
    model: 'gpt-4o-mini',
    pricingKnown: true,
    tokens: 10,
    estimatedCost: 0.00001,
    timestamp: Date.now(),
    prompt: 'repeat scoped billing prompt',
  };

  core.check({ ...base, scopeKey: 'session:a' });
  core.check({ ...base, scopeKey: 'session:b' });
  assert.equal(core.getState().blockedCount, 0);

  const scopeA = core.getState().scopes['session:a'];
  scopeA.recentPrompts[0].timestamp = Date.now() - 10;

  core.check({ ...base, scopeKey: 'session:a' });
  assert.equal(scopeA.recentPrompts.length, 1);
});

/** Rewinds every scope's last-activity clock so reclamation can be exercised without waiting. */
function backdateScopes(core, ms) {
  const backdated = Date.now() - ms;
  for (const scope of Object.values(core.getState().scopes ?? {})) {
    scope.lastRequestTime = backdated;
  }
}

test('GuardCore uses collision-resistant scope keys and bounds scope creation', () => {
  const core = new GuardCore({ budget: 1, maxScopes: 2 });
  const first = core.extractContext([
    { model: 'gpt-4o-mini', prompt: 'one', max_tokens: 1, projectId: 'a|user:b', userId: 'c' },
  ]);
  const second = core.extractContext([
    { model: 'gpt-4o-mini', prompt: 'one', max_tokens: 1, projectId: 'a', userId: 'b|c' },
  ]);

  assert.notEqual(first.scopeKey, second.scopeKey);
  core.check(first);
  core.check(second);

  const third = core.extractContext([{ model: 'gpt-4o-mini', prompt: 'three', max_tokens: 1, projectId: 'third' }]);
  assert.throws(
    () => core.check(third),
    (error) => error instanceof GuardError && error.code === 'SCOPE_LIMIT_EXCEEDED'
  );
});

test('GuardCore reclaims only idle session scopes when scopeIdleTtlMs is set', () => {
  const request = (sessionId) =>
    new GuardCore({ budget: 1 }).extractContext([
      { model: 'gpt-4o-mini', prompt: 'work', max_tokens: 1, sessionId },
    ]);

  const withoutTtl = new GuardCore({ budget: 1, maxScopes: 2 });
  withoutTtl.check(request('s1'));
  withoutTtl.check(request('s2'));
  backdateScopes(withoutTtl, 60_000);
  assert.throws(
    () => withoutTtl.check(request('s3')),
    (error) => error instanceof GuardError && error.code === 'SCOPE_LIMIT_EXCEEDED',
    'idle scopes are never dropped without an explicit scopeIdleTtlMs'
  );
  assert.equal(withoutTtl.getState().reclaimedScopeCount ?? 0, 0);

  const withTtl = new GuardCore({ budget: 1, maxScopes: 2, scopeIdleTtlMs: 1_000 });
  withTtl.check(request('s1'));
  withTtl.check(request('s2'));
  backdateScopes(withTtl, 60_000);
  withTtl.check(request('s3'));

  const state = withTtl.getState();
  assert.equal(state.reclaimedScopeCount, 2);
  assert.equal(Object.keys(state.scopes).length, 1);
  assert.ok(state.reservedCost > 0, 'process-wide spend survives reclamation');
});

test('GuardCore never reclaims long-lived or still-active scopes', () => {
  const longLived = new GuardCore({ budget: 1, maxScopes: 2, scopeIdleTtlMs: 1_000 });
  longLived.check(longLived.extractContext([{ model: 'gpt-4o-mini', prompt: 'a', max_tokens: 1, projectId: 'p1' }]));
  longLived.check(longLived.extractContext([{ model: 'gpt-4o-mini', prompt: 'b', max_tokens: 1, userId: 'u1' }]));
  backdateScopes(longLived, 60_000);
  assert.throws(
    () => longLived.check(longLived.extractContext([{ model: 'gpt-4o-mini', prompt: 'c', max_tokens: 1, projectId: 'p2' }])),
    (error) => error instanceof GuardError && error.code === 'SCOPE_LIMIT_EXCEEDED',
    'project and user scopes are never evicted'
  );

  const active = new GuardCore({ budget: 1, maxScopes: 2, scopeIdleTtlMs: 60_000 });
  active.check(active.extractContext([{ model: 'gpt-4o-mini', prompt: 'a', max_tokens: 1, sessionId: 'live' }]));
  active.check(active.extractContext([{ model: 'gpt-4o-mini', prompt: 'b', max_tokens: 1, sessionId: 'also-live' }]));
  assert.throws(
    () => active.check(active.extractContext([{ model: 'gpt-4o-mini', prompt: 'c', max_tokens: 1, sessionId: 'new' }])),
    (error) => error instanceof GuardError && error.code === 'SCOPE_LIMIT_EXCEEDED',
    'a session that is still inside the TTL is never evicted'
  );
});

test('GuardCore gives a reclaimed session a fresh budget without moving the aggregate', () => {
  const core = new GuardCore({ budget: 0.001, maxScopes: 2, scopeIdleTtlMs: 1_000 });
  const call = (sessionId) =>
    core.extractContext([{ model: 'gpt-4o-mini', prompt: 'spend', max_tokens: 1_000, sessionId }]);
  const perCall = 0.0006;

  core.check(call('s1'));
  core.check(call('s2'));
  assert.throws(() => core.check(call('s1')), (error) => error instanceof GuardError && error.code === 'BUDGET_EXCEEDED');

  backdateScopes(core, 60_000);
  core.check(call('s3'));
  assert.equal(core.getState().reclaimedScopeCount, 2);

  // s1 returns after its scope was reclaimed, so it starts from a fresh per-session budget.
  core.check(call('s1'));
  assert.equal(core.getState().reclaimedScopeCount, 2, 'no further sweep is needed below the cap');

  const state = core.getState();
  assert.equal(Object.keys(state.scopes).length, 2);
  assert.ok(
    Math.abs(state.reservedCost - perCall * 4) < 1e-12,
    `the process-wide aggregate must keep every reservation, including reclaimed scopes, got ${state.reservedCost}`
  );
  assert.equal(
    Math.abs(state.scopes['[null,null,"s1",null]'].reservedCost - perCall) < 1e-12,
    true,
    'only the per-scope balance was reset'
  );
});

test('GuardCore rejects an invalid scopeIdleTtlMs', () => {
  for (const scopeIdleTtlMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => new GuardCore({ budget: 1, scopeIdleTtlMs }),
      (error) => error instanceof GuardError && error.code === 'CONFIG_INVALID' && /scopeIdleTtlMs/u.test(error.message)
    );
  }
});

test('GuardCore records actual usage when provider responses include usage fields', () => {
  const core = new GuardCore({ budget: 1 });
  const context = core.extractContext([
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 10,
    },
  ]);

  core.check(context);
  core.recordActualUsage(context, { usage: { prompt_tokens: 12, completion_tokens: 4 } });

  assert.ok(context.actualCost > 0);
  assert.equal(core.getState().actualCost, context.actualCost);
});

test('GuardCore keeps reservation and actual usage distinct across usage variance', () => {
  const core = new GuardCore({ budget: 10 });
  const context = core.extractContext([{ model: 'gpt-4o-mini', prompt: 'variance', max_tokens: 10 }]);
  core.check(context);
  const reserved = core.getState().reservedCost;

  core.recordActualUsage(context, { usage: { prompt_tokens: 0, completion_tokens: 0 } });
  assert.equal(context.actualCost, 0);
  assert.equal(core.getState().reservedCost, reserved);

  const larger = core.extractContext([{ model: 'gpt-4o-mini', prompt: 'larger', max_tokens: 1 }]);
  core.check(larger);
  core.recordActualUsage(larger, { usage: { prompt_tokens: 10_000, completion_tokens: 10_000 } });
  assert.ok(larger.actualCost > larger.estimatedCost);
  assert.equal(core.getState().reservedCost, core.getState().totalCost);
});
