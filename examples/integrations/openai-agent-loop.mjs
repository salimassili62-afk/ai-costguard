import { guard, GuardError } from '@salimassili/ai-costguard';

const fakeOpenAI = {
  chat: {
    completions: {
      create: async (request) => ({
        id: `mock-${request.messages.length}`,
        choices: [{ message: { content: 'mocked OpenAI response' } }],
        usage: { prompt_tokens: 24, completion_tokens: request.max_tokens ?? 16 },
      }),
    },
  },
};

const openai = guard(fakeOpenAI, {
  budget: 1,
  loopSimilarityThreshold: 0.9,
  loopMinRepeats: 2,
  scope: { projectId: 'openai-agent-demo', sessionId: 'run-1' },
});

let blocked = false;

for (let step = 1; step <= 3; step++) {
  try {
    await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'inspect the same failing tool result and try to continue' }],
      max_tokens: 64,
    });
  } catch (error) {
    if (error instanceof GuardError) {
      blocked = true;
      console.log(JSON.stringify({ blocked, step, code: error.code }, null, 2));
      break;
    }

    throw error;
  }
}

if (!blocked) {
  throw new Error('Expected loop protection to block the repeated agent prompt.');
}
