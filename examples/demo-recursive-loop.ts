import { guard, GuardError } from '@salimassili/ai-costguard';

const fakeAgent = {
  chat: {
    completions: {
      create: async () => ({
        choices: [{ message: { content: 'Still thinking...' } }],
        usage: { prompt_tokens: 20, completion_tokens: 20 },
      }),
    },
  },
};

const agent = guard(fakeAgent, { budget: 10 });

async function main() {
  console.log('Recursive loop demo');

  for (let index = 1; index <= 5; index++) {
    try {
      await agent.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Calculate the optimal solution' }],
        max_tokens: 200,
      });
      console.log(`call ${index}: allowed`);
    } catch (error) {
      if (error instanceof GuardError) {
        console.log(`call ${index}: blocked with ${error.code}`);
        console.log(error.message);
        return;
      }
      throw error;
    }
  }
}

main().catch(console.error);
