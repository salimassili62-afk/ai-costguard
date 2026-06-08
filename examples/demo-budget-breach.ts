import { guard, GuardError } from '@salimassili/ai-costguard';

const fakeAgent = {
  chat: {
    completions: {
      create: async () => ({
        choices: [{ message: { content: 'Analyzed document.' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 4000 },
      }),
    },
  },
};

const agent = guard(fakeAgent, {
  budget: 1,
  behaviorAnalysis: false,
});

async function main() {
  console.log('Budget breach demo');

  for (let index = 1; index <= 15; index++) {
    try {
      await agent.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: `Analyze document ${index}` }],
        max_tokens: 4000,
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
