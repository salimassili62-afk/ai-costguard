import { guard, GuardError, registerTokenizer } from '@salimassili/ai-costguard';

const slackWebhook = process.env.COSTGUARD_SLACK_WEBHOOK;
let providerCalls = 0;

// Keeps this demo output quiet and deterministic. Production apps can keep the
// default estimator or register a provider-specific tokenizer.
registerTokenizer('gpt-4o-mini', (text) => Math.ceil(text.length / 4));

const mockedOpenAI = {
  chat: {
    completions: {
      create: async () => {
        providerCalls += 1;
        return {
          id: 'mocked-provider-response',
          choices: [{ message: { content: 'This should never execute in the demo.' } }],
        };
      },
    },
  },
};

const openai = guard(mockedOpenAI, {
  budget: 0.0001,
  scope: { projectId: 'sales-demo', sessionId: 'slack-webhook-block-demo' },
  webhooks: {
    slack: slackWebhook,
    retries: 0,
    timeoutMs: 1000,
  },
});

console.log('AI CostGuard Slack webhook block demo');
console.log('Scenario: an agent tries to start an expensive model call with almost no budget left.');
console.log(`Slack alert: ${slackWebhook ? 'enabled from COSTGUARD_SLACK_WEBHOOK' : 'off by default'}`);

try {
  await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content:
          'Run a large analysis job, summarize every retry, and reserve enough output for a long report.',
      },
    ],
    max_tokens: 800,
  });

  throw new Error('Expected AI CostGuard to block before the mocked provider ran.');
} catch (error) {
  if (!(error instanceof GuardError)) {
    throw error;
  }

  console.log('Result: BLOCKED before provider execution');
  console.log(`Reason: ${error.code}`);
  console.log(`Estimated avoided spend: $${error.context.estimatedCost.toFixed(6)}`);
  console.log(`Provider calls executed: ${providerCalls}`);
  console.log('Webhook URL printed: no');
}

if (providerCalls !== 0) {
  throw new Error(`Provider executed ${providerCalls} time(s); expected 0.`);
}
