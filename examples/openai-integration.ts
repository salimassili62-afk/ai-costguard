/**
 * OpenAI Integration Example
 *
 * This shows how to use AI CostGuard with the OpenAI SDK.
 */

import OpenAI from 'openai';
import { guard, GuardError } from '../src/index';

const openai = guard(
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }),
  { budget: 10 }
);

async function main() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Explain quantum computing in simple terms' }],
    });

    console.log('Response:', response.choices[0].message.content);
  } catch (error) {
    if (error instanceof GuardError) {
      console.log('Request blocked:', error.message);
      return;
    }
    throw error;
  }
}

main().catch(console.error);
