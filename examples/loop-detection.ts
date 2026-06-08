import { guard, GuardError } from '@salimassili/ai-costguard';

const fakeOpenAI = {
  chat: {
    completions: {
      create: async () => ({
        choices: [{ message: { content: 'Processing...' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    },
  },
};

const openai = guard(fakeOpenAI, { budget: 100 });

async function main() {
  console.log('Loop detection demo');

  for (let index = 1; index <= 5; index++) {
    try {
      await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Are we there yet?' }],
        max_tokens: 50,
      });
      console.log(`call ${index}: allowed`);
    } catch (error) {
      if (error instanceof GuardError) {
        console.log(`call ${index}: blocked with ${error.code}`);
        return;
      }
      throw error;
    }
  }
}

main().catch(console.error);
