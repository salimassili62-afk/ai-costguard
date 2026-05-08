/**
 * Example: OpenAI with cost protection
 *
 * Wrap your OpenAI client and set hard limits.
 * Run: npm run dev
 */

import { withCostGuard, CostGuardError } from '../src/index';

// Simulated OpenAI client (swap for real one)
const fakeOpenAI = {
  chat: {
    completions: {
      create: async ({ model, messages }: any) => {
        return {
          choices: [{ message: { content: `Reply to: ${messages[0].content}` } }],
          usage: { total_tokens: 100 },
        };
      },
    },
  },
};

const openai = withCostGuard(fakeOpenAI, {
  maxTokensPerRequest: 4000,
  maxRequestsPerMinute: 30,
  maxTotalCostPerDay: 5.00,
  loopDetection: true,
});

async function main() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    console.log('Response:', response.choices[0].message.content);
  } catch (err) {
    if (err instanceof CostGuardError) {
      console.log('Blocked:', err.message);
    } else {
      throw err;
    }
  }
}

main();
