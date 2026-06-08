import { guardFunction, GuardError } from '@salimassili/ai-costguard';

async function mockLangChainInvoke(request) {
  return {
    content: `mock LangChain response for ${request.prompt}`,
    usage: { prompt_tokens: 32, completion_tokens: request.max_tokens ?? 64 },
  };
}

const invoke = guardFunction(mockLangChainInvoke, {
  budget: 1,
  retryThreshold: 2,
  scope: { projectId: 'langchain-demo', sessionId: 'retriever-run' },
});

const prompts = [
  'retry failed retrieval after timeout for customer A',
  'again after 429 error for customer B',
  'repeat after failed vector search for customer C',
];

for (const prompt of prompts) {
  try {
    await invoke({ model: 'gpt-4o-mini', prompt, max_tokens: 64 });
  } catch (error) {
    if (error instanceof GuardError) {
      console.log(JSON.stringify({ blocked: true, code: error.code }, null, 2));
    } else {
      throw error;
    }
  }
}
