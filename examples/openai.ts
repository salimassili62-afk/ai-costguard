import { guard, GuardError } from '@salimassili/ai-costguard';

const fakeOpenAI = {
  chat: {
    completions: {
      create: async ({ messages }: any) => ({
        choices: [{ message: { content: `Reply to: ${messages[0].content}` } }],
        usage: { prompt_tokens: 8, completion_tokens: 12 },
      }),
    },
  },
};

const openai = guard(fakeOpenAI, { budget: 5 });

async function main() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100,
    });
    console.log(response.choices[0].message.content);
  } catch (error) {
    if (error instanceof GuardError) {
      console.log('Blocked:', error.code, error.message);
      return;
    }
    throw error;
  }
}

main().catch(console.error);
