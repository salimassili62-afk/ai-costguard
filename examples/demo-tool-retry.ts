/**
 * Demo: Tool Retry Explosion
 *
 * Simulates an AI agent that keeps retrying a failing external tool.
 * CostGuard detects the endless retries and kills the loop.
 */

import { withCostGuard, CostGuardError } from '../src/index';

// Fake agent with a failing tool integration
const fakeAgent = {
  chat: {
    completions: {
      create: async ({ messages }: any) => {
        const content = messages[0].content;

        // Simulate agent trying to use a failing tool
        if (content.includes('search') || content.includes('fetch')) {
          // Agent keeps retrying the same failed operation
          return {
            choices: [{
              message: {
                content: 'Error: Tool failed. Retrying... Retrying... Retrying...'
              }
            }]
          };
        }

        return {
          choices: [{ message: { content: 'Success' } }]
        };
      }
    }
  }
};

// Wrap with strict retry limits
const agent = withCostGuard(fakeAgent, {
  maxTotalCostPerDay: 5,
  maxRequestsPerMinute: 3,  // Very strict to catch hammering
  loopDetection: true
});

async function main() {
  console.log('=== Tool Retry Explosion Demo ===\n');
  console.log('Agent keeps retrying a failed tool call:');
  console.log('"Error: Tool failed. Retrying... Retrying..."\n');

  const searchPrompt = 'Search the database for user data';

  for (let i = 1; i <= 10; i++) {
    try {
      console.log(`Call ${i}: Agent retrying failed tool...`);
      await agent.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: searchPrompt }]
      });

      // Small delay to simulate real retry timing
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      if (err instanceof CostGuardError) {
        console.log('\n✅ RETRY EXPLOSION BLOCKED');
        console.log(`   ${err.message}`);
        console.log('\n💰 Prevented runaway retry loop.');
        console.log('   Agent would have hammered your API indefinitely.');
        return;
      }
    }
  }

  console.log('\n❌ Demo failed: retry loop should have been detected');
}

main();
