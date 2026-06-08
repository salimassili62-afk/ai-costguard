import { guard } from '@salimassili/ai-costguard';

const fakeClient = {
  chat: {
    completions: {
      create: async () => ({ ok: true }),
    },
  },
};

const guarded = guard(fakeClient, { budget: 5 });

async function run() {
  const result = await guarded.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 10,
  });

  console.log(result);
}

run();
