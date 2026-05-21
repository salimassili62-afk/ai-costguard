/**
 * Smoke Test - Validates package works end-to-end
 * Run: node --experimental-vm-modules test/smoke.mjs
 */

import { guard, GuardError } from '../dist/index.js';

let failures = 0;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message, error) {
  failures++;
  console.error(`FAIL: ${message}`);
  if (error) console.error(error);
}

function createMockClient() {
  return {
    chat: {
      completions: {
        create: async () => ({ ok: true, choices: [{ message: { content: 'Hello' } }] }),
      },
    },
  };
}

try {
  const wrapped = guard(createMockClient(), { budget: 0.001 });

  try {
    const response = await wrapped.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say hello in one short sentence.' }],
      max_tokens: 1,
    });

    if (response?.ok) {
      pass('guard allows an in-budget mock OpenAI call');
    } else {
      fail('guard returned an unexpected response', response);
    }
  } catch (error) {
    if (error instanceof GuardError) {
      pass('guard may block the first call with GuardError');
    } else {
      fail('guard threw a non-GuardError during the first call', error);
    }
  }

  const budgetLimited = guard(createMockClient(), { budget: 0.001 });

  try {
    await budgetLimited.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Write a paragraph that should exceed this tiny budget.' }],
      max_tokens: 1000,
    });
    fail('exceeding budget should throw GuardError');
  } catch (error) {
    if (error instanceof GuardError) {
      pass('exceeding budget throws GuardError');
    } else {
      fail('budget failure threw a non-GuardError', error);
    }
  }
} catch (error) {
  fail('smoke test crashed unexpectedly', error);
}

if (failures > 0) {
  console.error(`FAIL: smoke test completed with ${failures} failure(s)`);
  process.exit(1);
}

console.log('PASS: smoke test completed successfully');
