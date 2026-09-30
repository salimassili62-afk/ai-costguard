import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BUILTIN_PRICING_LAST_UPDATED,
  getPricing,
  getPricingMeta,
  listBuiltInPricing,
  listPricing,
  registerPricing,
  validatePricing,
} from '../dist/esm/index.js';
import { daysAgo } from './helpers/dates.mjs';

test('pricing resolves exact, fuzzy, runtime, and override entries', () => {
  assert.equal(BUILTIN_PRICING_LAST_UPDATED, '2026-09-30');
  assert.equal(getPricing('gpt-4o-mini')?.model, 'gpt-4o-mini');
  assert.equal(getPricing('claude-3-haiku-20240307')?.model, 'claude-3-haiku');
  assert.equal(getPricing('internal-gpt-4-wrapper'), undefined);
  // Asserted against the real registry rather than a hand-written expectation, so a price change
  // in the snapshot cannot silently break an unrelated resolution test.
  const opus = getPricing('claude-opus-4-1');
  assert.equal(opus?.model, 'claude-opus-4-1');
  assert.equal(opus?.outputPer1kTokens, 0.075);
  assert.equal(opus?.inputPer1kTokens, 0.015);
  // A dated suffix on a current Anthropic model resolves to the family entry.
  assert.equal(getPricing('claude-sonnet-4-5-20260101')?.model, 'claude-sonnet-4-5');
  assert.equal(getPricing('claude-haiku-4-5-20260101')?.model, 'claude-haiku-4-5');

  registerPricing([
    {
      model: 'unit-runtime-model',
      inputPer1kTokens: 0.1,
      outputPer1kTokens: 0.2,
      lastUpdated: daysAgo(1),
      source: 'unit-test',
    },
  ]);

  assert.equal(getPricing('unit-runtime-model')?.outputPer1kTokens, 0.2);

  const override = getPricing('override-model', [
    {
      model: 'override-model',
      inputPer1kTokens: 1,
      outputPer1kTokens: 2,
      lastUpdated: daysAgo(1),
      source: 'unit-test',
    },
  ]);

  assert.equal(override?.inputPer1kTokens, 1);
  assert.ok(listPricing().some((entry) => entry.model === 'unit-runtime-model'));
});

test('pricing metadata reports freshness for resolved models', () => {
  const meta = getPricingMeta('gpt-4o-mini');

  assert.equal(meta?.pricing.model, 'gpt-4o-mini');
  assert.equal(meta?.registryLastUpdated, BUILTIN_PRICING_LAST_UPDATED);
  assert.equal(typeof meta?.ageDays, 'number');
  assert.equal(typeof meta?.stale, 'boolean');
});

test('pricing metadata separates an exact registry hit from a family-prefix guess', () => {
  // A `-` suffix falls back to the nearest family entry, so a model the registry has never heard of
  // can still be costed. That is better than blocking, but the caller must be able to tell a
  // verified price from an assumed one, because the assumed price can be wrong in either
  // direction: `gpt-4o-realtime-preview` is priced here at the `gpt-4o` rate.
  assert.equal(getPricingMeta('gpt-4.1')?.match, 'exact');
  assert.equal(getPricingMeta('gpt-4.1')?.pricing.model, 'gpt-4.1');

  for (const model of [
    'gpt-4.1-turbo',
    'gpt-5-ultra',
    'gpt-4o-realtime-preview',
    'claude-sonnet-4-5-20260101',
  ]) {
    const meta = getPricingMeta(model);
    assert.equal(meta?.match, 'family-prefix', `${model} must be reported as a family-prefix guess`);
    assert.notEqual(meta?.pricing.model, model, `${model} must not claim to be a registry entry`);
  }

  assert.equal(getPricingMeta('claude-sonnet-4-5-20260101')?.pricing.model, 'claude-sonnet-4-5');

  // A name with no family in the registry is still unresolved, and therefore still blocked.
  assert.equal(getPricingMeta('totally-made-up-model'), undefined);
  assert.equal(getPricingMeta('claude-haiku-4.5'), undefined, 'a dotted date is not a family match');

  // Runtime and override entries classify the same way.
  assert.equal(
    getPricingMeta('unit-runtime-model', [])?.match,
    'exact',
    'an exact runtime entry is an exact match'
  );
  assert.equal(
    getPricingMeta('unit-runtime-model-20260101', [])?.match,
    'family-prefix',
    'a dated suffix on a runtime entry is a family-prefix guess'
  );
  assert.equal(
    getPricingMeta('override-model-x', [
      { model: 'override-model', inputPer1kTokens: 1, outputPer1kTokens: 2, lastUpdated: daysAgo(1), source: 'unit-test' },
    ])?.match,
    'family-prefix',
    'an override that only matches by family is reported as such'
  );
});

test('pricing warns once for stale entries older than 30 days', () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));

  try {
    registerPricing([
      {
        model: 'stale-unit-model',
        inputPer1kTokens: 0.1,
        outputPer1kTokens: 0.2,
        lastUpdated: '2020-01-01',
        source: 'unit-test',
      },
    ]);

    getPricing('stale-unit-model');
    getPricing('stale-unit-model');
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /older than 30 days/);
});

test('pricing rejects malformed safety inputs before registration or override use', () => {
  const valid = {
    model: 'valid-model',
    inputPer1kTokens: 0,
    outputPer1kTokens: 0.002,
    lastUpdated: daysAgo(1),
    source: 'unit-test',
  };

  assert.doesNotThrow(() => validatePricing(valid));

  for (const invalid of [
    { ...valid, inputPer1kTokens: Number.NaN },
    { ...valid, outputPer1kTokens: Number.POSITIVE_INFINITY },
    { ...valid, inputPer1kTokens: -1 },
    { ...valid, model: '' },
    { ...valid, model: 'has whitespace' },
    { ...valid, lastUpdated: '2026-02-30' },
    { ...valid, source: '' },
    { ...valid, inputPer1kTokens: undefined },
    { ...valid, outputPer1kTokens: undefined },
  ]) {
    assert.throws(() => registerPricing([invalid]), TypeError);
    assert.throws(() => getPricing('valid-model', [invalid]), TypeError);
  }
});

// Prices below are transcribed from the provider pages in each entry's `source` field, converted from
// USD per 1M tokens to USD per 1k. They are asserted as literals rather than read back from the
// registry, because a registry that silently drifts is exactly the failure these tests exist to catch.

test('the corrected gpt-4o price is exact and no longer the pre-cutoff rate', () => {
  const entry = getPricing('gpt-4o');

  assert.equal(entry?.model, 'gpt-4o');
  // $2.50 / $10.00 per 1M. The registry previously carried $5 / $15, a 2x input overcharge.
  assert.equal(entry?.inputPer1kTokens, 0.0025);
  assert.equal(entry?.outputPer1kTokens, 0.01);
  assert.equal(entry?.lastUpdated, BUILTIN_PRICING_LAST_UPDATED);
  assert.equal(getPricingMeta('gpt-4o')?.match, 'exact');
});

test('published variants that differ from their family are pinned to their own price', () => {
  // Each of these would otherwise inherit its family's rate, and in three of the four cases the
  // family is more expensive, so an unlisted variant silently over-reserves or under-reserves.
  const pinned = [
    ['gpt-4o-2024-05-13', 0.005, 0.015, 'gpt-4o'],
    ['gpt-4o-2024-08-06', 0.0025, 0.01, 'gpt-4o'],
    ['gpt-4-turbo-2024-04-09', 0.01, 0.03, 'gpt-4'],
    ['gpt-3.5-turbo-1106', 0.001, 0.002, 'gpt-3.5-turbo'],
    ['gpt-3.5-turbo-instruct', 0.0015, 0.002, 'gpt-3.5-turbo'],
  ];

  for (const [model, input, output, family] of pinned) {
    const entry = getPricing(model);
    assert.equal(entry?.model, model, `${model} must not fall through to ${family}`);
    assert.equal(entry?.inputPer1kTokens, input, `${model} input price`);
    assert.equal(entry?.outputPer1kTokens, output, `${model} output price`);
    assert.equal(getPricingMeta(model)?.match, 'exact', `${model} must resolve as an exact match`);
  }
});

test('models absent from the registry are blocked rather than priced from a relative', () => {
  // Each of these is a real, published model that this snapshot deliberately does not carry: their
  // price depends on the request's context length and ModelPricing cannot express that. Falling back
  // to a family rate would under-reserve long-context requests, so they must resolve to undefined and
  // hit the fail-closed UNKNOWN_MODEL path.
  for (const model of ['gpt-5.4', 'gpt-5.5', 'gpt-6-sol', 'gpt-6-luna', 'gemini-1.5-pro']) {
    assert.equal(getPricingMeta(model), undefined, `${model} must not resolve from a family guess`);
  }
});

test('longest family wins when two entries share a prefix', () => {
  // `claude-sonnet-4` and `claude-sonnet-4-6` both prefix `claude-sonnet-4-6-20260101`. Matching the
  // shorter family would bill a current model at an older generation's rate.
  assert.equal(getPricing('claude-sonnet-4-6-20260101')?.model, 'claude-sonnet-4-6');
  assert.equal(getPricing('claude-sonnet-4-20260101')?.model, 'claude-sonnet-4');
  assert.equal(getPricing('claude-sonnet-4-5-20260101')?.model, 'claude-sonnet-4-5');

  // Same shape on the OpenAI side: `gpt-5.2-pro` must not be priced as `gpt-5.2`.
  assert.equal(getPricing('gpt-5.2-pro')?.model, 'gpt-5.2-pro');
  assert.equal(getPricing('gpt-5.2-mini-2026-01-01')?.model, 'gpt-5.2');
});

test('every built-in entry that was not re-verified keeps an older date than the verification pass', () => {
  const unverified = listBuiltInPricing()
    .filter((entry) => entry.lastUpdated !== BUILTIN_PRICING_LAST_UPDATED)
    .map((entry) => entry.model)
    .sort();

  // Back-dating an unverified price would destroy the only signal a reader has about which numbers
  // are trustworthy, so this list is asserted explicitly and any change to it is a deliberate act.
  assert.deepEqual(unverified, [
    'claude-3-haiku',
    'claude-3-opus',
    'claude-3-sonnet',
    'deepseek-chat',
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gpt-4',
    'grok-4',
    'llama-3.3-70b',
    'mistral-large',
  ]);

  // Every OpenAI and Anthropic entry that survived the pass is dated, and every unverified entry
  // reports itself as stale rather than quietly presenting as fresh.
  for (const entry of listBuiltInPricing()) {
    if (unverified.includes(entry.model)) {
      assert.equal(getPricingMeta(entry.model)?.stale, true, `${entry.model} must report as stale`);
    }
  }

  assert.equal(getPricingMeta('gpt-4o')?.stale, false, 'a re-verified entry must not report as stale');
});
