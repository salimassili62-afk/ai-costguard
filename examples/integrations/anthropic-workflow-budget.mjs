import { guard, GuardError } from '@salimassili/ai-costguard';

const fakeAnthropic = {
  messages: {
    create: async (request) => ({
      id: 'mock-anthropic-message',
      content: [{ type: 'text', text: 'mocked Anthropic response' }],
      usage: { input_tokens: 120, output_tokens: request.max_tokens ?? 100 },
    }),
  },
};

const anthropic = guard(fakeAnthropic, {
  budget: 0.002,
  scope: { projectId: 'anthropic-workflow-demo', sessionId: 'daily-summary' },
});

await anthropic.messages.create({
  model: 'claude-haiku-4.5',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'Draft a short workflow summary.' }],
});

try {
  await anthropic.messages.create({
    model: 'claude-haiku-4.5',
    max_tokens: 1000,
    messages: [{ role: 'user', content: 'Draft a much longer workflow summary.' }],
  });
} catch (error) {
  if (error instanceof GuardError) {
    console.log(JSON.stringify({ blocked: true, code: error.code, estimatedCost: error.context.estimatedCost }, null, 2));
  } else {
    throw error;
  }
}
