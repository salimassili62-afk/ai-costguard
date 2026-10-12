# AI CostGuard

[![npm version](https://img.shields.io/npm/v/@salimassili/ai-costguard)](https://www.npmjs.com/package/@salimassili/ai-costguard)
[![MIT License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

**A pre-call spend firewall for Node.js AI agents.**

AI CostGuard estimates the cost of selected AI model calls and blocks requests that exceed your configured budget or execution limits **before the provider method is called**.

- **Free and open source:** complete runtime under the MIT license.
- **Local-first:** runs inside your Node.js process.
- **No guard API key or cloud account required.**
- **Built for control:** budgets, retry storms, repeated prompts, and execution limits.

[Install from npm](https://www.npmjs.com/package/@salimassili/ai-costguard) · [Quick Start](#quick-start) · [Documentation](#documentation)

## Why AI CostGuard?

AI agents can waste tokens and money through repeated prompts, retry storms, excessive steps, and concurrent calls.

AI CostGuard adds a cost and execution check before selected SDK methods run.

- Enforce estimated-cost budgets.
- Limit execution with `maxSteps`.
- Detect repeated-prompt loops and retry storms.
- Reject calls when required pricing or output limits are unavailable.
- Reserve budget atomically for concurrent calls within one process.
- Emit structured errors and optional local events and webhook alerts.

## Quick Start

**Requirements:** Node.js 18 or later.

Install:

```bash
npm install @salimassili/ai-costguard
```

Wrap your OpenAI client:

```ts
import OpenAI from 'openai';
import { guard, GuardError } from '@salimassili/ai-costguard';

const openai = guard(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  {
    budget: 5,
    maxSteps: 50,
    scope: { projectId: 'my-app' },
  },
);

try {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'user', content: 'Write a short summary.' },
    ],
    max_tokens: 200,
  });

  console.log(response.choices[0]?.message?.content);
} catch (error) {
  if (error instanceof GuardError) {
    console.error(error.code, error.message);
  } else {
    throw error;
  }
}
```

The example configures a **$5 estimated-cost budget** for the selected scope. Set `OPENAI_API_KEY` in your environment before making a real provider call.

## Try It Without API Costs

Clone the repository and run the deterministic mock demo:

```bash
npm ci
npm run build
node examples/integrations/quick-demo.mjs
```

The demo requires no provider API key, network request, or paid API call.

Expected output:

```text
Attempt 1: ALLOW
Attempt 2: ALLOW
Attempt 3: BLOCK BUDGET_EXCEEDED
Provider calls: 2
Blocked provider calls: 1
```

The third request is blocked before the mock provider method executes.

## Coverage

By default, AI CostGuard guards these SDK method paths:

- `chat.completions.create`
- `completions.create`
- `responses.create`
- `messages.create`

It can also wrap custom methods and function-style SDK integrations. Other methods pass through untouched unless explicitly configured.

Example with a custom client:

```ts
const client = guard(customClient, {
  budget: 2,
  guardedMethods: ['agent.run'],
});
```

See [Coverage](docs/COVERAGE.md) for the precise list of guarded and unguarded methods.

## Important Limitations

AI CostGuard is a **pre-call cost estimator, not a billing ledger or an exact-cost guarantee**.

- **Estimated costs:** budget decisions use estimated costs reserved before a call. Provider-reported usage does not refund those reservations.
- **Pricing freshness:** built-in pricing is a maintained snapshot, not a live provider feed. Verify prices and override them when necessary.
- **Token estimation:** token counts can be approximate. Register a provider tokenizer when tighter estimates matter.
- **Process-local budgets:** independent processes and workers do not automatically share one budget.
- **Explicit coverage:** raw `fetch`, unwrapped clients, and unlisted methods are not intercepted.
- **Streaming:** requests with `stream: true` are rejected rather than guarded using an unknown final token count.
- **Heuristic detection:** loop and retry detection can produce false positives or false negatives.
- **Not a security boundary:** AI CostGuard does not protect API keys, reconcile invoices, or replace provider billing alerts.

Some model names may resolve to a built-in model-family pricing entry instead of an exact model entry. Verify production pricing before relying on estimates.

## Documentation

- [Accounting and cost semantics](docs/ACCOUNTING.md)
- [Guarded and unguarded methods](docs/COVERAGE.md)
- [Shared budgets across processes](docs/SHARED-BUDGET.md)
- [SDK and framework integrations](docs/INTEGRATIONS.md)
- [Local dashboard and operational caveats](docs/DASHBOARD.md)
- [Benchmarks and measurement limits](docs/BENCHMARKS.md)
- [Architecture](ARCHITECTURE.md)
- [Security reporting](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Development

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run smoke
```

## License

MIT. See [LICENSE](LICENSE).

