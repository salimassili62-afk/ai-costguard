/**
 * Basic Example - AI CostGuard MVP
 * 
 * Shows how to wrap an OpenAI client with cost protection.
 * Run: npm run example
 */

import { guard, GuardError } from '../src/core/CostGuard.js';

// Simulated OpenAI client (for demo without real API key)
const fakeOpenAI = {
  chat: {
    completions: {
      create: async ({ model, messages }) => {
        const content = messages[0].content;
        return {
          choices: [{ message: { content: `Reply to: ${content}` } }],
          usage: { total_tokens: 100 },
        };
      },
    },
  },
};

// Wrap with cost protection
const protectedAI = guard(fakeOpenAI, { budget: 5.00 });

async function main() {
  console.log('=== AI CostGuard Demo ===\n');

  // Example 1: Normal call (allowed)
  console.log('1. Normal call...');
  try {
    const r1 = await protectedAI.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello AI' }],
    });
    console.log('   ✅ Allowed:', r1.choices[0].message.content);
  } catch (e) {
    console.log('   ❌ Blocked:', e.message);
  }

  // Example 2: Loop detection (blocked)
  console.log('\n2. Simulating loop (same prompt 3x)...');
  for (let i = 0; i < 3; i++) {
    try {
      await protectedAI.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Same prompt' }],
      });
      console.log('   ✅ Call', i + 1, 'allowed');
    } catch (e) {
      if (e instanceof GuardError) {
        console.log('   ❌ BLOCKED:', e.message);
      }
    }
  }

  // Example 3: Excessive tokens (blocked)
  console.log('\n3. Excessive tokens (10,000)...');
  try {
    await protectedAI.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'X'.repeat(5000) }],
    });
    console.log('   ✅ Allowed');
  } catch (e) {
    if (e instanceof GuardError) {
      console.log('   ❌ BLOCKED:', e.message);
    }
  }

  console.log('\n=== Demo Complete ===');
  console.log('In production, real API calls would be intercepted and blocked.');
}

main();
