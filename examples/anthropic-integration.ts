import Anthropic from '@anthropic-ai/sdk';
import { guard, GuardError, registerPricing } from '@salimassili/ai-costguard';

registerPricing([
  {
    model: 'claude-3-5-sonnet',
    inputPer1kTokens: 0.003,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-06-07',
    source: 'application override',
  },
]);

const anthropic = guard(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' }), {
  budget: 10,
  scope: { projectId: 'docs-anthropic' },
});

async function main() {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 300,
      messages: [{ role: 'user', content: 'Explain quantum computing in simple terms.' }],
    });

    console.log(response.content[0]?.type === 'text' ? response.content[0].text : response.content[0]);
  } catch (error) {
    if (error instanceof GuardError) {
      console.log('Request blocked:', error.code, error.message);
      return;
    }
    throw error;
  }
}

main().catch(console.error);
