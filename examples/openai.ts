/**
 * Example: OpenAI with cost protection
 *
 * Wrap your OpenAI client and set hard limits.
 * Run: npm run dev
 */

import { guard, GuardError } from '../src/index';

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

const openai = guard(fakeOpenAI, { budget: 5.00 });

async function main() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    console.log('Response:', response.choices[0].message.content);
  } catch (err) {
    if (err instanceof GuardError) {
      console.log('Blocked:', err.message);
    } else {
      throw err;
    }
  }
}

main();
