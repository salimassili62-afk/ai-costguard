import { guardFunction, GuardError } from '@salimassili/ai-costguard';

async function mockCrewAiLauncher(request) {
  return {
    command: 'crewai run',
    launched: false,
    reason: 'mock example only; no Python process or paid API call is started',
    request,
  };
}

const runCrewAi = guardFunction(mockCrewAiLauncher, {
  budget: 0.01,
  scope: { projectId: 'crewai-demo', sessionId: 'crew-run-1' },
});

try {
  const result = await runCrewAi({
    model: 'gpt-4o-mini',
    prompt: 'Run a CrewAI research workflow with a strict budget gate.',
    max_tokens: 500,
  });

  console.log(JSON.stringify({ ok: true, command: result.command, launched: result.launched }, null, 2));
} catch (error) {
  if (error instanceof GuardError) {
    console.log(JSON.stringify({ ok: false, code: error.code }, null, 2));
  } else {
    throw error;
  }
}
