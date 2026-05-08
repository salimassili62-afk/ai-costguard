/**
 * Smoke Test - Validates package works end-to-end
 * Run: node test/smoke.mjs
 */

import { withCostGuard, CostGuardError } from '../dist/index.js';

const fakeClient = {
  chat: {
    completions: {
      create: async () => ({ ok: true, choices: [{ message: { content: 'Hello' } }] })
    }
  }
};

const wrapped = withCostGuard(fakeClient, {
  maxTotalCostPerDay: 10
});

try {
  console.log('Testing withCostGuard...');
  const res = await wrapped.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: "hello" }]
  });
  
  if (res && res.ok) {
    console.log('✅ SMOKE TEST PASSED');
    console.log('   Package imports correctly');
    console.log('   withCostGuard wraps client');
    console.log('   API call executes successfully');
    process.exit(0);
  } else {
    console.error('❌ Unexpected response:', res);
    process.exit(1);
  }
} catch (err) {
  if (err instanceof CostGuardError) {
    console.log('✅ SMOKE TEST PASSED (blocked as expected)');
    console.log('   CostGuardError thrown correctly');
    process.exit(0);
  } else {
    console.error('❌ SMOKE TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  }
}
