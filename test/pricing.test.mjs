import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BUILTIN_PRICING_LAST_UPDATED,
  getPricing,
  getPricingMeta,
  listPricing,
  registerPricing,
  validatePricing,
} from '../dist/index.js';

test('pricing resolves exact, fuzzy, runtime, and override entries', () => {
  assert.equal(BUILTIN_PRICING_LAST_UPDATED, '2026-08-23');
  assert.equal(getPricing('gpt-4o-mini')?.model, 'gpt-4o-mini');
  assert.equal(getPricing('claude-3-haiku-20240307')?.model, 'claude-3-haiku');
  assert.equal(getPricing('internal-gpt-4-wrapper'), undefined);
  assert.equal(getPricing('claude-opus-4.8')?.outputPer1kTokens, 0.025);
  assert.equal(getPricing('claude-sonnet-4.6-20260601')?.model, 'claude-sonnet-4.6');

  registerPricing([
    {
      model: 'unit-runtime-model',
      inputPer1kTokens: 0.1,
      outputPer1kTokens: 0.2,
      lastUpdated: '2026-05-21',
      source: 'unit-test',
    },
  ]);

  assert.equal(getPricing('unit-runtime-model')?.outputPer1kTokens, 0.2);

  const override = getPricing('override-model', [
    {
      model: 'override-model',
      inputPer1kTokens: 1,
      outputPer1kTokens: 2,
      lastUpdated: '2026-05-21',
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
    lastUpdated: '2026-08-23',
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
