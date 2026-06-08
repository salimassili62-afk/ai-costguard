import OpenAI from 'openai';
import { guard, GuardError } from '@salimassili/ai-costguard';

const openai = guard(new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' }), {
  budget: 10,
  scope: { projectId: 'demo' },
});

async function main() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Write a short welcome message.' }],
      max_tokens: 120,
    });

    console.log(response.choices[0]?.message?.content ?? '');
  } catch (error) {
    if (error instanceof GuardError) {
      console.error('Blocked by AI CostGuard:', error.code, error.message);
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
