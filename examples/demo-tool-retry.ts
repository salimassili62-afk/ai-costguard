import { guard, GuardError } from '@salimassili/ai-costguard';

const fakeAgent = {
  chat: {
    completions: {
      create: async () => ({
        choices: [{ message: { content: 'Tool failed. Retrying...' } }],
        usage: { prompt_tokens: 30, completion_tokens: 30 },
      }),
    },
  },
};

const agent = guard(fakeAgent, { budget: 5, retryThreshold: 2 });

async function main() {
  console.log('Retry storm demo');

  const prompts = [
    'retry failed search request for user data',
    'again after timeout while fetching user data',
    'repeat after error while fetching user data',
  ];

  for (const [index, prompt] of prompts.entries()) {
    try {
      await agent.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
      });
      console.log(`call ${index + 1}: allowed`);
    } catch (error) {
      if (error instanceof GuardError) {
        console.log(`call ${index + 1}: blocked with ${error.code}`);
        console.log(error.message);
        return;
      }
      throw error;
    }
  }
}

main().catch(console.error);
