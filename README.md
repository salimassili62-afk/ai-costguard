# AI CostGuard
[![npm version](https://img.shields.io/npm/v/@salimassili/ai-costguard)](https://www.npmjs.com/package/@salimassili/ai-costguard)

AI CostGuard is a local-first runtime safety layer for AI agents that prevents runaway costs, loops, retries, and budget explosions before API calls execute. It wraps OpenAI-compatible clients and function-style SDK calls, estimates request cost locally, blocks budget overruns, detects repeated prompts, emits structured events, and exposes CLI checks plus a local dashboard.

It is local-first. It does not include a SaaS control plane, cloud dashboard, proxy gateway, telemetry service, billing reconciliation service, or hard security boundary.

## What AI CostGuard Does

- Checks selected AI SDK calls before they execute.
- Estimates request cost from model pricing, prompt text, and reserved output tokens.
- Blocks unknown models unless explicit pricing is supplied.
- Blocks budget overruns, repeated prompt loops, retry storms, and max-step overruns.
- Emits structured errors and local events your app can handle.

## What AI CostGuard Does Not Do

- It does not call providers for real-time pricing.
- It does not reconcile provider invoices or replace provider billing alerts.
- It does not provide auth, API-key security, or a hard security boundary.
- It does not run a hosted dashboard, SaaS backend, or cloud telemetry service.
- It does not guarantee exact tokenizer parity with OpenAI, Anthropic, or other providers.

## Install

```bash
npm install @salimassili/ai-costguard
```

## Quick Start

```ts
import OpenAI from 'openai';
import { guard, GuardError } from '@salimassili/ai-costguard';

const openai = guard(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
  budget: 5,
  maxSteps: 50,
  scope: { projectId: 'my-app' },
});

try {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Write a short summary.' }],
    max_tokens: 200,
  });

  console.log(response.choices[0]?.message?.content);
} catch (error) {
  if (error instanceof GuardError) {
    console.error(error.code, error.message, error.context);
  } else {
    throw error;
  }
}
```

## Before / After

Without AI CostGuard:

```ts
await openai.chat.completions.create(request);
```

With AI CostGuard:

```ts
const openai = guard(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
  budget: 5,
  maxSteps: 50,
  scope: { projectId: 'agent-api', sessionId: runId },
});

await openai.chat.completions.create(request);
```

## What It Guards

By default AI CostGuard evaluates these SDK method paths:

- `chat.completions.create`
- `completions.create`
- `responses.create`
- `messages.create`

Other client methods are passed through without cost checks. To protect a custom client method:

```ts
const client = guard(customClient, {
  budget: 2,
  guardedMethods: ['agent.run'],
  pricingOverrides: [
    {
      model: 'internal-model',
      inputPer1kTokens: 0.001,
      outputPer1kTokens: 0.002,
      lastUpdated: '2026-06-07',
      source: 'internal pricing sheet',
    },
  ],
});
```

For function-style SDKs such as Vercel AI SDK adapters, LangChain wrappers, or agent runners:

```ts
import { guardFunction } from '@salimassili/ai-costguard';

const guardedGenerateText = guardFunction(generateTextAdapter, {
  budget: 1,
  scope: { projectId: 'chatbot' },
});

await guardedGenerateText({
  model: 'gpt-4o-mini',
  prompt: 'Answer the user in one paragraph.',
  max_tokens: 200,
});
```

## Decisions And Errors

Blocked requests throw `GuardError` before the provider method is called.

```ts
try {
  await openai.chat.completions.create(request);
} catch (error) {
  if (error instanceof GuardError) {
    console.log(error.code);
    console.log(error.metadata);
  }
}
```

Current runtime block codes:

- `UNKNOWN_MODEL`
- `BUDGET_EXCEEDED`
- `MAX_STEPS_EXCEEDED`
- `LOOP_DETECTED`
- `RETRY_STORM_DETECTED`

## Configuration

```ts
guard(client, {
  budget: 10,
  maxSteps: 100,
  behaviorAnalysis: true,
  maxHistory: 32,
  historyTtlMs: 5 * 60 * 1000,
  loopSimilarityThreshold: 0.85,
  loopMinRepeats: 2,
  retryThreshold: 2,
  scope: {
    projectId: 'production-api',
    userId: 'optional-user',
    sessionId: 'optional-agent-run',
  },
  guardedMethods: ['chat.completions.create', 'responses.create'],
  pricingOverrides: [],
  webhooks: {
    slack: process.env.SLACK_WEBHOOK,
    discord: process.env.DISCORD_WEBHOOK,
    retries: 2,
    timeoutMs: 1500,
  },
  eventLogPath: '.ai-costguard/events.jsonl',
  eventLogPrompt: 'none',
});
```

`scope` isolates budgets and behavior history. If no scope is supplied, the guard uses one process-local default scope.

## Loop Detection Tuning

Default loop detection uses character trigram cosine similarity with `loopSimilarityThreshold: 0.85` and `loopMinRepeats: 2`.

- Higher threshold, such as `0.95`: fewer false positives, but near-duplicate loops can slip through.
- Lower threshold, such as `0.75`: catches looser repeats, but unrelated prompts can be blocked.
- Higher `loopMinRepeats`: waits for more repeated prompts before blocking.
- Lower `loopMinRepeats`: blocks faster, but is more aggressive.

```ts
const openai = guard(client, {
  budget: 5,
  loopSimilarityThreshold: 0.9,
  loopMinRepeats: 3,
  scope: { sessionId: 'agent-run-123' },
});
```

Loop detection is heuristic. Expect false positives and false negatives, especially for short prompts, templated prompts, and prompts that share a lot of boilerplate.

## Accounting Semantics

AI CostGuard is a pre-call estimator, not a billing ledger.

- `attemptedCost`: estimated cost of every guarded attempt, including blocked attempts.
- `totalCost`: estimated cost of allowed calls.
- `blockedCost`: estimated cost stopped before provider execution.
- `actualCost`: provider-reported usage cost when the response includes recognizable `usage` fields.

Budget decisions use estimated allowed cost. Actual usage is recorded for observability but does not rewrite earlier decisions.

## Pricing

Known model pricing comes from built-in registry entries, runtime registrations, or per-guard overrides. Unknown models are blocked by default.

Pricing last updated: `2026-06-07`. Provider pricing changes; AI CostGuard does not fetch real-time pricing. Override pricing manually when provider pages or your contract pricing differ from the built-ins.

```ts
import { registerPricing } from '@salimassili/ai-costguard';

registerPricing([
  {
    model: 'my-company-model',
    inputPer1kTokens: 0.001,
    outputPer1kTokens: 0.002,
    lastUpdated: '2026-06-07',
    source: 'internal',
  },
]);
```

If you intentionally want fallback pricing for unknown models:

```ts
guard(client, {
  budget: 5,
  unknownModelPolicy: 'fallback',
  unknownModelPricing: {
    model: 'fallback',
    inputPer1kTokens: 0.001,
    outputPer1kTokens: 0.002,
    lastUpdated: '2026-06-07',
    source: 'application fallback',
  },
});
```

Pricing changes frequently. Verify provider pricing before production use and override entries when needed.

## Events

```ts
const unsubscribe = openai.on('block', (event) => {
  console.log(event.code, event.reason, event.context.estimatedCost);
});

unsubscribe();
```

Supported events are `cost`, `allow`, and `block`. Handler errors are swallowed so observability code cannot change guard decisions.

## Local Dashboard

Opt into a local JSONL event log:

```ts
const openai = guard(client, {
  budget: 5,
  eventLogPath: '.ai-costguard/events.jsonl',
});
```

Start the local-only dashboard:

```bash
ai-costguard dashboard --events .ai-costguard/events.jsonl --budget 5
```

For one-off package execution:

```bash
npx @salimassili/ai-costguard dashboard --events .ai-costguard/events.jsonl --budget 5
```

If the package is installed locally, `npx ai-costguard dashboard` also works. The dashboard binds to `127.0.0.1` by default and reads only local event files.

For CI or terminal output:

```bash
ai-costguard dashboard --events .ai-costguard/events.jsonl --budget 5 --once --json
```

See `docs/DASHBOARD.md`.

## Integrations

Runnable mocked examples are included for:

- OpenAI SDK agent loop protection
- Anthropic SDK workflow budget guard
- Vercel AI SDK chatbot budget cap
- LangChain retry-storm prevention
- Mastra-style agent runner protection
- CrewAI launch/budget gate
- CI budget checks

See `docs/INTEGRATIONS.md` and `examples/integrations`.

## Express Middleware

The middleware attaches a manual checker. It does not automatically parse or inspect every route.

```ts
import { middleware, GuardError } from '@salimassili/ai-costguard';

app.use(middleware({ budget: 2 }));

app.post('/chat', async (req, res, next) => {
  try {
    req.localSafety.check({
      model: 'gpt-4o-mini',
      tokens: 500,
      inputTokens: 100,
      outputTokens: 400,
      estimatedCost: 0.0003,
      timestamp: Date.now(),
      prompt: String(req.body?.prompt ?? ''),
    });

    res.json({ ok: true });
  } catch (error) {
    if (error instanceof GuardError) {
      res.status(403).json({ code: error.code, reason: error.message });
      return;
    }
    next(error);
  }
});
```

## Optional Redis / Pro Helper

Redis-backed shared spend tracking is isolated behind a subpath import:

```ts
import { GuardPro } from '@salimassili/ai-costguard/pro';

const pro = new GuardPro({
  redisUrl: process.env.REDIS_URL ?? '',
  budget: 25,
  windowSeconds: 86400,
});

await pro.checkAndCharge('production', 0.0042);
await pro.shutdown();
```

`ioredis` is an optional dependency and is not loaded by the root import.

AI CostGuard does not include license-key checks or local commercial-license enforcement.

## CLI

```bash
aifw check --budget 1 --model gpt-4o-mini --input-tokens 500 --tokens 1000 --max-steps 5
```

The package also installs an `ai-costguard` bin alias:

```bash
ai-costguard check --budget 1 --model gpt-4o-mini --tokens 1000 --max-steps 5
ai-costguard dashboard --events .ai-costguard/events.jsonl --budget 5
```

For custom models:

```bash
aifw check --budget 1 --model internal-model --tokens 1000 --input-price-per-1k 0.001 --output-price-per-1k 0.002
```

Exit codes:

- `0`: projected cost is within budget
- `1`: projected cost exceeds budget
- `2`: usage/config error

## Benchmarks

Run local benchmarks:

```bash
npm run build
npm run benchmark
```

The script reports runtime overhead, approximate heap delta, false-positive scenarios, loop detection behavior, and cost-estimation boundaries. Results are local measurements, not universal guarantees. See `docs/BENCHMARKS.md`.

Latest local benchmark in this repo on Node `v24.14.1` / Windows measured `0.020691 ms` added per mocked guarded call over `5000` iterations. Re-run on your target runtime before using this number in performance-sensitive claims.

Token accuracy benchmark, fixed corpus, `gpt-tokenizer cl100k_base` fixture counts: average error `259.08%`, median error `263.98%`, max error `323.53%`, `8` samples. The current estimator is conservative and can substantially overestimate short prompts. Use this package as a pre-call guardrail, not an exact tokenizer.

## Why Not 50 Lines Of Code?

A simple homemade budget check can stop one request after one counter crosses one number. AI CostGuard packages the parts that usually become messy once agents enter production:

- Provider pricing registry with runtime overrides and unknown-model blocking.
- Structured `GuardError` codes and metadata for API responses.
- Scoped budget and behavior state per project, user, or session.
- TTL-bounded prompt history.
- Loop and retry-storm detection.
- Estimated, attempted, blocked, and actual usage accounting.
- Method filtering so non-AI SDK calls are not charged.
- Event hooks, best-effort webhooks, JSONL event logs, and local dashboard visibility.
- CI budget checks and runnable integration examples.

## Development

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run smoke
npm run benchmark
npm audit --omit=dev
npm pack --dry-run
```

## Limitations

- Token counting is approximate and dependency-free.
- Token estimation is intentionally conservative and can overestimate materially; see the token accuracy benchmark.
- Pricing entries can become stale; override them for production.
- The free guard is process-local.
- Loop detection uses character trigram similarity, not embeddings.
- Retry detection is heuristic.
- Webhooks are best-effort and never affect enforcement.
- The dashboard reads local JSONL logs only; it is not a hosted analytics product.
- Provider usage reconciliation only works when responses expose recognizable `usage` fields.

## License

MIT
