/**
 * Demo: Budget Breach Protection
 *
 * Simulates an AI agent that burns through tokens rapidly.
 * CostGuard enforces a hard daily budget limit.
 */

import { withCostGuard, CostGuardError } from '../src/index';

// Fake agent that processes large documents
const fakeAgent = {
  chat: {
    completions: {
      create: async ({ messages, model }: any) => {
        const content = messages[0].content;

        // Simulate expensive processing
        if (content.includes('analyze') || content.includes('process')) {
          return {
            choices: [{
              message: {
                content: `Analyzed ${content}. This used 4000 tokens.`,
                usage: { total_tokens: 4000 }
              }
            }]
          };
        }

        return {
          choices: [{
            message: {
              content: 'Done',
              usage: { total_tokens: 100 }
            }
          }]
        };
      }
    }
  }
};

// Wrap with tight budget limit
const agent = withCostGuard(fakeAgent, {
  maxTotalCostPerDay: 1.00,  // Only $1 budget!
  maxTokensPerRequest: 4000,
  loopDetection: true
});

async function main() {
  console.log('=== Budget Breach Demo ===\n');
  console.log('Daily budget: $1.00');
  console.log('Each request costs ~$0.12 (GPT-4 with 4K tokens)\n');
  console.log('Agent is processing documents rapidly...\n');

  for (let i = 1; i <= 15; i++) {
    try {
      console.log(`Call ${i}: Processing document...`);
      await agent.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'analyze this large document' }],
        max_tokens: 4000
      });
    } catch (err) {
      if (err instanceof CostGuardError) {
        console.log('\n✅ BUDGET CAP TRIGGERED');
        console.log(`   ${err.message}`);
        console.log('\n💰 Hard limit enforced.');
        console.log('   Without CostGuard: runaway costs.');
        console.log('   With CostGuard: predictable spending.');
        return;
      }
    }
  }

  console.log('\n❌ Demo failed: budget limit should have been enforced');
}

main();
