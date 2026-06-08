import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getPricing, listPricing, registerPricing } from '../dist/index.js';

test('pricing resolves exact, fuzzy, runtime, and override entries', () => {
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
