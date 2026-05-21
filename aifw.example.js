// AI CostGuard - Node.js Example

import { guard } from '@salimassili/ai-costguard';
import OpenAI from 'openai';

const openai = guard(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  { budget: 50 }
);

const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
});

console.log(response.choices[0]?.message?.content ?? '');
