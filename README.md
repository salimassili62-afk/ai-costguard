# AI CostGuard

[![npm version](https://img.shields.io/npm/v/@salimassili/ai-costguard)](https://www.npmjs.com/package/@salimassili/ai-costguard)
[![MIT License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

**A pre-call spend firewall for Node.js AI agents.**

AI CostGuard estimates the cost of selected model calls and blocks requests that violate your configured budget or execution policies **before the provider method is called**.

- **Free and open source:** complete runtime under the MIT license.
- **Local-first:** runs inside your Node.js process.
- **No dependencies required by the core package, API key for the guard itself, account, telemetry, or license checks.**
- **Separate paid product:** a Production Verification Toolkit for teams that need reproducible evidence of runtime behavior.

[Install from npm](https://www.npmjs.com/package/@salimassili/ai-costguard) · [Documentation](#documentation) · [Production Verification Toolkit](https://aicostguard.lemonsqueezy.com/checkout/buy/8801cd1c-d7ea-4df8-a2e7-e54565f32e65)

## Why AI CostGuard?

AI agent costs can grow through repeated prompts, retry storms, excessive steps, and concurrent calls sharing a budget.

AI CostGuard adds an economic check before selected SDK calls execute.

- Enforce estimated-cost budgets.
- Detect repeated-prompt loops and retry storms.
- Limit execution with `maxSteps`.
- Reject requests when required pricing or output limits are unavailable.
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

The example uses a budget of **$5** for the configured scope. Set your provider API key as an environment variable before making a real provider call.

## See a Block in 90 Seconds

Clone the repository, then run the deterministic mock demo:

```bash
npm run build
node examples/integrations/quick-demo.mjs
```

No provider API key, network request, or paid API call is required for this demo.

Expected output:

```text
Attempt 1: ALLOW
Attempt 2: ALLOW
Attempt 3: BLOCK BUDGET_EXCEEDED
Provider calls: 2
Blocked provider calls: 1
```

The mock provider's own counter stays at two calls. The third request is blocked before the provider method executes.

## What It Protects

By default, AI CostGuard guards these SDK method paths:

- `chat.completions.create`
- `completions.create`
- `responses.create`
- `messages.create`

It can also wrap custom methods and function-style SDK integrations. Other methods are passed through untouched unless explicitly configured.

For custom methods:

```ts
const client = guard(customClient, {
  budget: 2,
  guardedMethods: ['agent.run'],
});
```

See [Coverage](docs/COVERAGE.md) for exactly what is and is not guarded.

## Important Limits

AI CostGuard is a **pre-call estimator, not a billing ledger or an exact-cost guarantee**.

- **Estimates, not invoices.** Budget decisions use estimated cost reserved before a call. Provider-reported usage is for visibility and does not refund reservations.
- **Pricing can become stale.** Built-in pricing is a hand-maintained snapshot, not a live provider feed. Verify prices and override them when needed.
- **Token counts can be approximate.** Register a provider tokenizer when tighter estimates matter.
- **Process-local budgets.** In-memory enforcement does not create one shared budget across independent processes or workers.
- **Coverage is explicit.** Raw `fetch`, unwrapped clients, and unlisted methods are not intercepted.
- **Streaming is unsupported by the guard.** Requests with `stream: true` are rejected rather than charged using an unknown final token count.
- **Loop and retry detection are heuristics.** False positives and false negatives are possible.
- **Not a security boundary.** It does not secure API keys, reconcile invoices, or replace provider billing alerts.

Some model names may match a built-in family pricing entry rather than an exact entry. Verify the selected price for production use.

## Free Runtime vs. Paid Toolkit

The runtime is free, complete, and MIT-licensed. **There is no paid runtime tier or feature unlock.**

The separate [Production Verification Toolkit](https://aicostguard.lemonsqueezy.com/checkout/buy/8801cd1c-d7ea-4df8-a2e7-e54565f32e65) is a paid product for teams that need production-verification materials beyond the runtime itself.

The toolkit does not unlock runtime features. Review its checkout page for the current offer and included deliverables.

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
