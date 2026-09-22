import { guard, GuardError } from '@salimassili/ai-costguard';

console.log('--- AI CostGuard Demo ---\n');

const mockOpenAI = {
  chat: {
    completions: {
      create: async (req) => ({ choices: [{ message: { content: 'Hello!' } }] })
    }
  }
};

const client = guard(mockOpenAI, {
  budget: 0.05,
  model: 'gpt-4o-mini',
  maxSteps: 10
});

console.log('Guard configured: budget=$0.05, model=gpt-4o-mini\n');

try {
  await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 100
  });
  const state = client.getGuardState();
  console.log('✅ Call 1 ALLOWED — spend so far: $' + (state.totalCost ?? 0).toFixed(6));
} catch (e) {
  console.log('❌ Call 1 BLOCKED:', e.code, e.reason);
}

try {
  await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'x'.repeat(3000000) }],
    max_tokens: 200000
  });
  console.log('✅ Call 2 ALLOWED');
} catch (e) {
  if (e instanceof GuardError) {
    console.log('\n❌ Call 2 BLOCKED BEFORE hitting the API');
    console.log('   Code:  ', e.code);
    console.log('   Reason:', e.reason);
    console.log('   No API call was made. No money spent.');
  }
}

const state = client.getGuardState();
console.log('\n💰 Total spend: $' + (state.totalCost ?? 0).toFixed(6));
console.log('   Budget:      $0.050000');