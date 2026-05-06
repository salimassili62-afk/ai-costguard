import OpenAI from 'openai';
import { withFirewall } from '../src';

const client = withFirewall(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' }),
  {
    onBlock: (reason, usd) => {
      console.error(`Blocked before API call: ${reason} (estimated $${usd.toFixed(4)})`);
    },
  }
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
