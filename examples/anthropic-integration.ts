/**
 * Anthropic Integration Example
 *
 * This shows how to use AI CostGuard with the Anthropic SDK.
 */

import Anthropic from '@anthropic-ai/sdk';
import { guard, GuardError } from '../src/index';

const anthropic = guard(
  new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),
  { budget: 10 }
);

async function main() {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Explain quantum computing in simple terms' }],
    });

    console.log('Response:', response.content[0].text);
  } catch (error) {
    if (error instanceof GuardError) {
      console.log('Request blocked:', error.message);
      return;
    }
    throw error;
  }
}

main().catch(console.error);
