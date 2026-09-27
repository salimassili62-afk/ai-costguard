import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BUILTIN_PRICING_LAST_UPDATED,
  getPricing,
  getPricingMeta,
  listPricing,
  registerPricing,
  validatePricing,
} from '../dist/esm/index.js';
import { daysAgo } from './helpers/dates.mjs';

test('pricing resolves exact, fuzzy, runtime, and override entries', () => {
  assert.equal(BUILTIN_PRICING_LAST_UPDATED, '2026-08-23');
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
  // direction: `o3-pro` is priced here at the `o3` rate.
  assert.equal(getPricingMeta('gpt-4.1')?.match, 'exact');
  assert.equal(getPricingMeta('gpt-4.1')?.pricing.model, 'gpt-4.1');

  for (const model of ['gpt-4.1-turbo', 'gpt-5-ultra', 'o3-pro', 'claude-sonnet-4-5-20260101']) {
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
