/**
 * Example: Loop detection
 *
 * Simulates an AI agent stuck in a loop.
 * CostGuard detects the repetition, blocks it, and shows the estimated save.
 */

import { withCostGuard, CostGuardError } from '../src/index';

const fakeOpenAI = {
  chat: {
    completions: {
      create: async ({ messages }: any) => {
        return {
          choices: [{ message: { content: 'Processing...' } }],
        };
      },
    },
  },
};

const openai = withCostGuard(fakeOpenAI, {
  maxTotalCostPerDay: 100.00,
  loopDetection: true,
});

async function main() {
  const prompt = 'Are we there yet?';

  console.log('Simulating an AI agent stuck in a loop...\n');

  for (let i = 1; i <= 5; i++) {
    try {
      await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      if (err instanceof CostGuardError) {
        console.log('\n✅ Loop killed. Agent stopped before it could spiral.');
        break;
      }
    }
  }
}

main();
