import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GuardCore, GuardError } from '../dist/core/GuardCore.js';
import { cosineSimilarity } from '../dist/core/similarity.js';
import { estimateTokensForModel, estimateTokensFromText, estimateRequestTokens } from '../dist/core/tokenizer.js';
import { registerTokenizer } from '../dist/index.js';

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
    'claude-sonnet-4.6',
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
          lastUpdated: '2026-08-23',
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
        lastUpdated: '2026-06-07',
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
          lastUpdated: '2026-06-07',
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
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 2);
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
      lastUpdated: '2026-06-07',
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
        lastUpdated: '2026-08-23',
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
