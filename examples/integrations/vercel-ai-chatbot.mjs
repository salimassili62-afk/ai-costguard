import { guardFunction, GuardError } from '@salimassili/ai-costguard';

async function mockGenerateText(request) {
  return {
    text: `mocked answer for ${request.prompt}`,
    usage: { prompt_tokens: 40, completion_tokens: request.max_tokens ?? 80 },
  };
}

const generateText = guardFunction(mockGenerateText, {
  budget: 0.001,
  scope: { projectId: 'vercel-chatbot-demo', sessionId: 'chat-123' },
});

try {
  const result = await generateText({
    model: 'gpt-4o-mini',
    prompt: 'Answer the user in one paragraph.',
    max_tokens: 80,
  });

  console.log(JSON.stringify({ ok: true, text: result.text }, null, 2));
} catch (error) {
  if (error instanceof GuardError) {
    console.log(JSON.stringify({ ok: false, code: error.code }, null, 2));
  } else {
    throw error;
  }
}
