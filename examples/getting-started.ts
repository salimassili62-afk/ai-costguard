import OpenAI from 'openai';
import { guard } from '../src';

const client = guard(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' }),
  { budget: 10 }
);

async function main() {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Write a short welcome message.' }],
    max_tokens: 120,
  });

  console.log(response.choices[0]?.message?.content ?? '');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
