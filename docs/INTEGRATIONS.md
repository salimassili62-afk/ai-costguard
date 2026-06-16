# Integrations

AI CostGuard works best when it sits immediately before an AI provider call or agent step. The examples in `examples/integrations` use mocked SDK surfaces so they run without API keys or paid requests.

Run them after building the package:

```bash
npm run build
node examples/integrations/openai-agent-loop.mjs
node examples/integrations/anthropic-workflow-budget.mjs
node examples/integrations/vercel-ai-chatbot.mjs
node examples/integrations/langchain-retry-storm.mjs
node examples/integrations/mastra-agent.mjs
node examples/integrations/crewai-budget-gate.mjs
node examples/integrations/webhook-alerts.mjs
node examples/integrations/slack-alerts.mjs
node examples/integrations/ci-budget-check.mjs
```

## OpenAI SDK

Use `guard()` around the OpenAI client. AI CostGuard guards `chat.completions.create`, `responses.create`, and `completions.create` by default.

```ts
import OpenAI from 'openai';
import { guard } from '@salimassili/ai-costguard';

const openai = guard(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
  budget: 5,
  scope: { projectId: 'api', sessionId: 'agent-run-1' },
});

await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Summarize this ticket.' }],
  max_tokens: 200,
});
```

Runnable mock: `examples/integrations/openai-agent-loop.mjs`

## Anthropic SDK

Use `guard()` around the Anthropic client. AI CostGuard guards `messages.create` by default.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { guard } from '@salimassili/ai-costguard';

const anthropic = guard(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), {
  budget: 2,
  scope: { projectId: 'workflow', sessionId: 'daily-run' },
});

await anthropic.messages.create({
  model: 'claude-haiku-4.5',
  max_tokens: 300,
  messages: [{ role: 'user', content: 'Draft the daily workflow summary.' }],
});
```

Runnable mock: `examples/integrations/anthropic-workflow-budget.mjs`

## Vercel AI SDK

Vercel AI SDK calls are often function-style. Use `guardFunction()` around your `generateText` adapter and pass a request object that includes `model`, prompt/messages, and output token limits.

```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { guardFunction } from '@salimassili/ai-costguard';

const guardedGenerateText = guardFunction(
  (request) => generateText({ model: openai(request.model), prompt: request.prompt }),
  { budget: 1, scope: { projectId: 'chatbot' } }
);

await guardedGenerateText({
  model: 'gpt-4o-mini',
  prompt: 'Answer the user in one paragraph.',
  max_tokens: 200,
});
```

Runnable mock: `examples/integrations/vercel-ai-chatbot.mjs`

## LangChain

LangChain shapes vary by model wrapper. The most reliable pattern is to guard a small adapter function that normalizes LangChain inputs into an object with model, prompt/messages, and max token fields.

```ts
import { guardFunction } from '@salimassili/ai-costguard';

const invoke = guardFunction(
  (request) => chatModel.invoke(request.prompt),
  {
    budget: 2,
    retryThreshold: 2,
    scope: { projectId: 'retrieval-agent', sessionId: 'run-42' },
  }
);

await invoke({
  model: 'gpt-4o-mini',
  prompt: 'retry failed retrieval after timeout',
  max_tokens: 150,
});
```

Runnable mock: `examples/integrations/langchain-retry-storm.mjs`

## Mastra

For object-style agent runners, guard the agent object and set `guardedMethods` to the method path you want to protect.

```ts
import { guard } from '@salimassili/ai-costguard';

const app = guard(mastraApp, {
  budget: 10,
  guardedMethods: ['agent.run'],
  scope: { projectId: 'mastra-agent' },
  pricingOverrides: [
    {
      model: 'internal-agent-model',
      inputPer1kTokens: 0.001,
      outputPer1kTokens: 0.002,
      lastUpdated: '2026-06-08',
      source: 'internal pricing',
    },
  ],
});
```

Runnable mock: `examples/integrations/mastra-agent.mjs`

## CrewAI

CrewAI is Python-native, so this TypeScript package cannot instrument internal Python SDK calls directly. Practical options:

- Use `aifw check` / `ai-costguard check` in CI or before launching a CrewAI run.
- Wrap a Node launcher or API boundary with `guardFunction()` before it starts the Python workflow.
- Use provider-side billing alerts for final reconciliation.

Runnable mock: `examples/integrations/crewai-budget-gate.mjs`

## Local Webhook And Slack Alerts

Alerts are local-first and optional. AI CostGuard only sends to a webhook URL you provide, and alert failures never change guard decisions.

```ts
import { guard } from '@salimassili/ai-costguard';

const openai = guard(client, {
  budget: { maxUsd: 5, thresholdPercent: 0.8 },
  projectId: 'agent-api',
  runId: 'run-1',
  alerts: {
    webhookUrl: process.env.COSTGUARD_WEBHOOK_URL,
    events: ['blocked', 'threshold'],
    timeoutMs: 1500,
  },
});
```

For Slack incoming webhooks, use `format: 'slack'` or `slack: true`:

```ts
const openai = guard(client, {
  budget: { maxUsd: 5 },
  alerts: {
    webhookUrl: process.env.COSTGUARD_SLACK_WEBHOOK,
    events: ['blocked'],
    format: 'slack',
  },
});
```

Runnable mocks: `examples/integrations/webhook-alerts.mjs` and `examples/integrations/slack-alerts.mjs`

## CI Budget Check

Use the CLI to fail a pipeline before a planned agent run can exceed budget.

```bash
ai-costguard check --budget 0.25 --model gpt-4o-mini --input-tokens 800 --tokens 1200 --max-steps 20
```

Runnable example: `examples/integrations/ci-budget-check.mjs`
