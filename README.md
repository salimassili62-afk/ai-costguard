# AI CostGuard

[![npm version](https://img.shields.io/npm/v/@salimassili/ai-costguard)](https://www.npmjs.com/package/@salimassili/ai-costguard)
[![MIT License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

**A pre-call spend firewall for Node.js AI agents.**

AI CostGuard estimates the cost of selected AI model calls and blocks requests that exceed your
budget or execution limits **before the provider method is called**.

- **Free and open source:** the complete runtime, MIT licensed.
- **Local-first:** runs inside your Node.js process.
- **No API key, cloud account, or telemetry required.**
- **Built for control:** budgets, retry storms, repeated prompts, and execution limits.

[Install from npm](https://www.npmjs.com/package/@salimassili/ai-costguard) · [Quick Start](#quick-start) · [Documentation](#documentation)

## Why AI CostGuard?

AI agents waste tokens and money through repeated prompts, retry storms, excessive steps, and
concurrent calls. Add one check before selected SDK methods run:

- Enforce estimated-cost budgets.
- Limit execution with `maxSteps`.
- Detect repeated-prompt loops and retry storms.
- Reject calls when required pricing or output limits are unavailable.
- Reserve budget atomically for concurrent calls within one process.
- Emit structured errors plus optional local events and webhook alerts.

## Quick Start

**Requires Node.js 18 or later.**

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
    messages: [{ role: 'user', content: 'Write a short summary.' }],
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

This configures a **$5 estimated-cost budget** for the selected scope. Set `OPENAI_API_KEY` before
making a real provider call.

## Try It Without API Costs

The deterministic mock demo proves the guard blocks a request **before** the provider method runs,
using a fake provider. It needs no provider credentials, makes no paid API call, and makes no
network request.

**If you installed from npm:**

```bash
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

## What the Budget Actually Enforces

AI CostGuard enforces a budget against a **pre-call estimate**, not a provider invoice. Read this
before trusting any number the guard reports.

- **Estimates, not bills.** The budget test compares estimated reserved cost. Provider-reported
  usage never changes a decision and never refunds a reservation. Treat the budget as a ceiling on
  estimated spend and `actualCost` as the reconciliation signal.
- **Output tokens are required, not guessed.** A guarded request must carry an output limit
  (`max_tokens`, `max_completion_tokens`, `maxTokens`, or `max_output_tokens`), or the config must
  set `defaultOutputTokens`. A request with neither is blocked with `OUTPUT_LIMIT_REQUIRED` rather
  than allowed uncosted.
- **Input tokens are approximate.** The built-in estimator is a dependency-free heuristic calibrated
  for ordinary prose and deliberately rounds against you. It does not understand code, base64, or
  non-Latin scripts, so estimates can be off in either direction. Register an exact tokenizer with
  `registerTokenizer()` when the number has to be tight; the guard warns once per model and scope
  when it falls back to the approximation.
- **Pricing is a static snapshot, not a live feed.** Nothing in this package fetches prices. Every
  built-in entry carries a `lastUpdated` date, and the package warns once at import when any entry is
  older than 30 days. Check freshness in CI with `npx ai-costguard pricing --check-stale` (exit 1
  when stale), verify the models you rely on, and override any that changed.
- **Reservations are never refunded.** The decision happens before the provider call, and a failed
  call can still have done billable work, so a reservation stands even when the call throws. A retry
  is a second reservation, which is why retry storms are detected and blocked separately.
- **Budgets bind per scope, per process.** `budget` is enforced for each scope
  (`project`/`user`/`session`/`run`). Separate processes do not share a balance unless you use the
  Redis-backed shared-budget `/pro` path.

See [docs/ACCOUNTING.md](docs/ACCOUNTING.md) for the full money model.

## Coverage

By default, AI CostGuard guards these SDK method paths:

- `chat.completions.create`
- `completions.create`
- `responses.create`
- `messages.create`

It can also wrap custom methods and function-style SDK integrations. Other methods pass through
untouched unless explicitly configured.

```ts
const client = guard(customClient, {
  budget: 2,
  guardedMethods: ['agent.run'],
});
```

See [docs/COVERAGE.md](docs/COVERAGE.md) for the precise list of guarded and unguarded methods.

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
`budgetLimitUsd`, `reservedCostUsd`, and `remainingUsd`. The details behind each block decision live
in [docs/COVERAGE.md](docs/COVERAGE.md) and [docs/ACCOUNTING.md](docs/ACCOUNTING.md).

## Important Limitations

AI CostGuard is a **pre-call cost estimator, not a billing ledger or an exact-cost guarantee**.

- **Estimated costs:** budget decisions use estimated costs reserved before a call. Provider-reported
  usage does not refund those reservations.
- **Pricing freshness:** built-in pricing is a maintained snapshot, not a live provider feed. Verify
  prices and override them when necessary.
- **Token estimation:** token counts can be approximate. Register a provider tokenizer when tighter
  estimates matter.
- **Process-local budgets:** independent processes and workers do not automatically share one budget.
- **Explicit coverage:** raw `fetch`, unwrapped clients, and unlisted methods are not intercepted.
- **Streaming:** requests with `stream: true` are rejected rather than guarded using an unknown final
  token count.
- **Heuristic detection:** loop and retry detection can produce false positives or false negatives.
- **Not a security boundary:** AI CostGuard does not protect API keys, reconcile invoices, or replace
  provider billing alerts.

Some model names may resolve to a built-in model-family pricing entry instead of an exact model entry.
Verify production pricing before relying on estimates.

## Free Runtime vs. Paid Toolkit

The runtime in this repository is the whole product, and it is **free and MIT licensed**: no paid
tier, no API key, no account, no telemetry, and no runtime license check. The quick start, the CLI,
the dashboard, and the Redis `/pro` shared budget all ship in the free package.

The only paid item is an **optional, separate** add-on you are never required to buy.

### Production Verification

**AI CostGuard Production Verification Toolkit — $49 one-time.** A local verification harness that
runs against the free runtime you already installed:

- **14 verification groups** covering runtime behavior and documented guarantees.
- **Structured evidence:** Markdown and JSON reports, plus JUnit XML for CI.
- **Failure testing:** a defined corpus of failure scenarios and checks for accounting and
  concurrency invariants.
- **Release verdicts:** PASS, PASS_WITH_WARNINGS, FAIL, or BLOCKED.

It runs locally, makes no network calls, and needs no cloud account, telemetry, or license key.

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
