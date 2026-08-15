import { guard, GuardError } from '@salimassili/ai-costguard';

const fakeMastraAgent = {
  agent: {
    run: async (request) => ({
      output: `mock Mastra agent result for ${request.prompt}`,
      usage: { inputTokens: 50, outputTokens: request.max_tokens ?? 100 },
    }),
  },
};

const guardedAgent = guard(fakeMastraAgent, {
  budget: 0.01,
  guardedMethods: ['agent.run'],
  scope: { projectId: 'mastra-demo', sessionId: 'agent-run-1' },
  pricingOverrides: [
    {
      model: 'mastra-demo-model',
      inputPer1kTokens: 0.001,
      outputPer1kTokens: 0.002,
      lastUpdated: '2026-06-08',
      source: 'example override',
    },
  ],
});

try {
  const result = await guardedAgent.agent.run({
    model: 'mastra-demo-model',
    prompt: 'Plan the next workflow step.',
    max_tokens: 100,
  });

  console.log(JSON.stringify({ ok: true, output: result.output }, null, 2));
} catch (error) {
  if (error instanceof GuardError) {
    console.log(JSON.stringify({ ok: false, code: error.code }, null, 2));
  } else {
    throw error;
  }
}
