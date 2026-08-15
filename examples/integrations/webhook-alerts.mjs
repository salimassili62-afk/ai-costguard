import { guard, GuardError, registerTokenizer } from '@salimassili/ai-costguard';

const webhookUrl = process.env.COSTGUARD_WEBHOOK_URL;
let providerCalls = 0;

registerTokenizer('gpt-4o-mini', (text) => Math.ceil(text.length / 4));

const mockedOpenAI = {
  chat: {
    completions: {
      create: async () => {
        providerCalls += 1;
        return { ok: true };
      },
    },
  },
};

const openai = guard(mockedOpenAI, {
  budget: { maxUsd: 0.0001 },
  projectId: 'webhook-alert-demo',
  runId: 'local-run-1',
  alerts: {
    webhookUrl,
    events: ['blocked'],
    timeoutMs: 1000,
  },
});

try {
  await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Reserve a long output for an expensive agent step.' }],
    max_tokens: 800,
  });

  throw new Error('Expected AI CostGuard to block the mocked provider call.');
} catch (error) {
  if (!(error instanceof GuardError)) throw error;

  console.log(
    JSON.stringify(
      {
        demo: 'webhook-alerts',
        alert: webhookUrl ? 'enabled from COSTGUARD_WEBHOOK_URL' : 'off by default',
        blocked: true,
        reason: error.code,
        providerCalls,
      },
      null,
      2
    )
  );
}

if (providerCalls !== 0) {
  throw new Error(`Provider executed ${providerCalls} time(s); expected 0.`);
}
