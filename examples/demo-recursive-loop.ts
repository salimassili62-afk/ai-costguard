/**
 * Demo: Recursive Loop Protection
 *
 * Simulates an AI agent that gets stuck repeating the same reasoning.
 * CostGuard detects the loop and kills it before money burns.
 */

import { guard, GuardError } from '../src/index';

// Fake OpenAI client that simulates an agent stuck in a loop
const fakeAgent = {
  chat: {
    completions: {
      create: async ({ messages }: any) => {
        const content = messages[0].content;

        // Simulate agent "thinking" and repeating itself
        if (content.includes('calculate') || content.includes('solve')) {
          return {
            choices: [{
              message: {
                content: 'Let me think about this... Actually, I need to calculate that. Let me recalculate. Let me think about this...'
              }
            }]
          };
        }

        return {
          choices: [{ message: { content: 'Done' } }]
        };
      }
    }
  }
};

// Wrap the agent with CostGuard
const agent = guard(fakeAgent, { budget: 10 });

async function main() {
  console.log('=== Recursive Loop Demo ===\n');
  console.log('Agent is stuck in a reasoning loop:');
  console.log('"Let me think... Let me recalculate... Let me think..."\n');

  // Short, exact same prompt to ensure loop detection works
  const stuckPrompt = 'Calculate optimal solution';

  for (let i = 1; i <= 5; i++) {
    try {
      console.log(`Call ${i}: Sending same prompt...`);
      await agent.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: stuckPrompt }]
      });
    } catch (err) {
      if (err instanceof GuardError) {
        console.log('\n✅ LOOP BLOCKED');
        console.log(`   ${err.message}`);
        console.log('\n💰 Your API budget is safe.');
        console.log('   Without CostGuard, this would have burned $$$.');
        return;
      }
    }
  }

  console.log('\n❌ Demo failed: loop should have been detected');
}

main();
