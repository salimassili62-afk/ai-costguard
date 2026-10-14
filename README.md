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


The deterministic mock demo proves the guard blocks a request **before** the provider method runs,
using a fake provider. Downloading or installing the package requires network access, but the mock
demo itself needs no provider credentials, makes no paid API call, and makes no network request.
## Production Verification

Already using AI CostGuard in production? The free runtime protects your application before selected AI provider calls. The paid **AI CostGuard Production Verification Toolkit** helps you verify the installed runtime before release.

- **14 verification groups** covering runtime behavior and documented guarantees.
- **Structured evidence:** Markdown and JSON reports, plus JUnit XML for CI.
- **Failure testing:** a defined corpus of failure scenarios and checks for accounting and concurrency invariants.
- **Release verdicts:** PASS, PASS_WITH_WARNINGS, FAIL, or BLOCKED.

The toolkit runs locally against the installed runtime. It does not require a cloud account, telemetry, or a runtime license key.

**Price: $199 one-time.**

[Get the Production Verification Toolkit](https://aicostguard.lemonsqueezy.com/checkout/buy/8801cd1c-d7ea-4df8-a2e7-e54565f32e65)
**If you installed from npm:**

```bash
npm install @salimassili/ai-costguard
node node_modules/@salimassili/ai-costguard/examples/integrations/quick-demo.mjs
```

**If you are working from a source checkout:**

```bash
npm ci
npm run build
node examples/integrations/quick-demo.mjs
```

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

## Errors

A blocked call throws a `GuardError` **before** the provider method runs. Branch on the stable
`error.code`; never parse the message text.

| Code | Meaning |
| --- | --- |
| `BUDGET_EXCEEDED` | The reservation would push this scope past its budget. |
| `UNKNOWN_MODEL` | No pricing entry for this model. The message names the closest built-in sibling. |
| `OUTPUT_LIMIT_REQUIRED` | No output token limit on the request and no `defaultOutputTokens`. |
| `LOOP_DETECTED` | Too many near-identical recent prompts. |
| `RETRY_STORM_DETECTED` | Too many retry or failure prompts. |
| `MAX_STEPS_EXCEEDED` | This scope already used its `maxSteps` allowance. |
| `STREAMING_UNSUPPORTED` | `stream: true`. Streams are blocked, not charged. |
| `SCOPE_LIMIT_EXCEEDED` | `maxScopes` reached. New scopes are blocked, never silently evicted. |
| `CONTEXT_INVALID` | The request could not be read as a model request. |
| `CONFIG_INVALID` | Invalid `GuardConfig`. Thrown at construction, not per request. |
| `SHARED_BUDGET_UNAVAILABLE` | Shared-budget (`/pro`) store unreachable. Fails closed. |

Every `GuardError` also exposes `error.metadata` with `scopeKey`, `model`, `estimatedCostUsd`,
`budgetLimitUsd`, `reservedCostUsd`, and `remainingUsd`. What each block decision means is detailed in
[docs/COVERAGE.md](docs/COVERAGE.md) and [docs/ACCOUNTING.md](docs/ACCOUNTING.md).

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

## Production Verification

Already using AI CostGuard in production? The free runtime protects your application before selected AI provider calls. The paid **AI CostGuard Production Verification Toolkit** helps you verify the installed runtime before release.

- **14 verification groups** covering runtime behavior and documented guarantees.
- **Structured evidence:** Markdown and JSON reports, plus JUnit XML for CI.
- **Failure testing:** a defined corpus of failure scenarios and checks for accounting and concurrency invariants.
- **Release verdicts:** PASS, PASS_WITH_WARNINGS, FAIL, or BLOCKED.

The toolkit runs locally against the installed runtime. It does not require a cloud account, telemetry, or a runtime license key.

**Price: $199 one-time.**

[Get the Production Verification Toolkit](https://aicostguard.lemonsqueezy.com/checkout/buy/8801cd1c-d7ea-4df8-a2e7-e54565f32e65)

## Documentation

- [Accounting and cost semantics](docs/ACCOUNTING.md)
- [Guarded and unguarded methods](docs/COVERAGE.md)
- [Shared budgets across processes](docs/SHARED-BUDGET.md)
- [SDK and framework integrations](docs/INTEGRATIONS.md)
- [Local dashboard and operational caveats](docs/DASHBOARD.md)
- [Benchmarks and measurement limits](docs/BENCHMARKS.md)
- [Repository orientation](START-HERE.md)
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

