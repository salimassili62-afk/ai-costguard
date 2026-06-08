import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GuardCore, GuardError } from '../dist/core/GuardCore.js';
import { cosineSimilarity } from '../dist/core/similarity.js';
import { estimateTokensFromText, estimateRequestTokens } from '../dist/core/tokenizer.js';
import { registerTokenizer } from '../dist/index.js';

test('token estimator uses inline BPE-style pieces instead of character/4 heuristic', () => {
  assert.equal(estimateTokensFromText('hello'), 3);
  assert.notEqual(estimateTokensFromText('hello'), Math.ceil('hello'.length / 4));

  const request = estimateRequestTokens({
    messages: [{ role: 'user', content: 'hello world' }],
    max_tokens: 10,
  });

  assert.equal(request.outputTokens, 10);
  assert.ok(request.inputTokens > 3);
  assert.equal(request.tokens, request.inputTokens + 10);
});

test('registered tokenizers override prompt token estimation by model string pattern', () => {
  registerTokenizer('unit-tokenizer-string', () => 7);

  const core = new GuardCore({
    budget: 1,
    pricingOverrides: [
      {
        model: 'unit-tokenizer-string-model',
        inputPer1kTokens: 1,
        outputPer1kTokens: 0,
        lastUpdated: '2026-06-07',
        source: 'unit-test',
      },
    ],
  });
  const context = core.extractContext([{ model: 'unit-tokenizer-string-model', prompt: 'hello world', max_tokens: 3 }]);

  assert.equal(context.inputTokens, 7);
  assert.equal(context.outputTokens, 3);
  assert.equal(context.tokens, 10);
  assert.equal(context.approximateTokens, false);
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

  assert.equal(warnings.length, 1);
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
});

test('GuardCore blocks similar prompt loops after repeated scoped matches', () => {
  const core = new GuardCore({ budget: 1, loopSimilarityThreshold: 0.85 });

  const first = {
    model: 'gpt-4o-mini',
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
