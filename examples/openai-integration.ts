import OpenAI from 'openai';
import { guard, GuardError } from '@salimassili/ai-costguard';

const openai = guard(new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' }), {
  budget: 10,
  maxSteps: 20,
  scope: { projectId: 'docs-openai' },
});

async function main() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Explain quantum computing in simple terms.' }],
      max_tokens: 300,
    });

    console.log(response.choices[0]?.message?.content ?? '');
  } catch (error) {
    if (error instanceof GuardError) {
      console.log('Request blocked:', error.code, error.message);
      return;
    }
    throw error;
  }
}

main().catch(console.error);
