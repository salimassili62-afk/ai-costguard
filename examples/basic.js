import { guard, GuardError } from '@salimassili/ai-costguard';

const fakeOpenAI = {
  chat: {
    completions: {
      create: async ({ messages }) => ({
        choices: [{ message: { content: `Reply to: ${messages[0].content}` } }],
        usage: { prompt_tokens: 12, completion_tokens: 18 },
      }),
    },
  },
};

const openai = guard(fakeOpenAI, { budget: 1 });

async function main() {
  console.log('AI CostGuard basic example');

  const first = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 50,
  });
  console.log(first.choices[0].message.content);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Repeat this same request' }],
        max_tokens: 50,
      });
      console.log(`loop attempt ${attempt}: allowed`);
    } catch (error) {
      if (error instanceof GuardError) {
        console.log(`loop attempt ${attempt}: blocked with ${error.code}`);
        return;
      }
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
