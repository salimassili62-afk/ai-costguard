# AI CostGuard
[![npm version](https://img.shields.io/npm/v/@salimassili/ai-costguard)](https://www.npmjs.com/package/@salimassili/ai-costguard)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

**Free and open source. 
MIT licensed.
No dependencies, no API key, no account, no telemetry , no license check.
** If you are reading this wondering which feature is unlocked, the answer
is all of them.
The Free runtime is complete. 
The paid product is a separate production-verification toolkit.

AI CostGuard is a pre-call spend guard for Node.js AI agents. It evaluates selected model calls in
process and blocks the next call when the configured estimated-cost or safety policy would be
exceeded — before your provider is ever called.

It is local-first and in-process. It does not include a SaaS control plane, cloud dashboard, proxy
gateway, telemetry service, billing reconciliation service, or hard security boundary.

## What AI CostGuard Does

- Checks selected AI SDK calls before they execute.
- Estimates request cost from model pricing, prompt text, and reserved output tokens.
- Blocks unknown models unless explicit pricing is supplied.
- Blocks budget overruns, repeated prompt loops, retry storms, and max-step overruns.
- Holds reservations atomically under concurrent in-process load, so N parallel calls cannot overspend.
- Emits structured errors and local events your app can handle.

## What AI CostGuard Does Not Do

- It does not call providers for real-time pricing. The built-in table is a dated, hand-maintained snapshot.
- It does not reconcile provider invoices or replace provider billing alerts.
- It does not provide auth, API-key security, or a hard security boundary.
- It does not run a hosted dashboard, SaaS backend, or cloud telemetry service.
- It does not intercept HTTP traffic. It guards the client methods you wrap, and nothing else.
- It does not guarantee exact tokenizer parity with OpenAI, Anthropic, or other providers.
- It does not enforce across processes by itself. See [docs/SHARED-BUDGET.md](docs/SHARED-BUDGET.md).

## Read this first

Two things are easy to assume and worth stating plainly.

**The budget is enforced against a pre-call estimate, not a bill.** The guard reserves what a call is
expected to cost and blocks on that reservation. Provider-reported usage is recorded for visibility
but never refunds a reservation. A request that would cost exactly the remaining budget is allowed.

**Built-in pricing is a snapshot, most recently verified `2026-09-30`.** Nothing here fetches provider
pricing. Every entry carries its own `lastUpdated` date and the package warns you once at startup when
an entry is more than 30 days old — 11 of 53 entries currently are, because they could not be
re-verified. Verify the models you rely on and override them. See
[docs/ACCOUNTING.md](docs/ACCOUNTING.md#which-models-are-priced) for exactly which models are priced and
which are not.

## Install

```bash
npm install @salimassili/ai-costguard
```

## 90-Second Demo

The deterministic demo needs no API key, no network, no provider SDK, and no money:

```bash
npm run build
node examples/integrations/quick-demo.mjs
```

It runs two mock provider calls, blocks the third before the mock provider executes, and prints the
structured block event:

```text
Attempt 1: ALLOW
Attempt 2: ALLOW
Attempt 3: BLOCK BUDGET_EXCEEDED
Provider calls: 2
Blocked provider calls: 1
```

The two lines that matter are `Provider calls: 2` and `Blocked provider calls: 1`. The mock provider
counts its own invocations, so `2` is proof that the blocked request never reached it.

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

Every other client method is passed straight through, untouched and **not charged**. That includes
`embeddings.create`, `images.generate`, `audio.transcriptions.create`, and anything you call on
`fetch`. AI CostGuard is an in-process proxy, not an HTTP interceptor: it never patches
`globalThis.fetch` and cannot see traffic your code sends by any other route.

The list is exported, so you can assert on it rather than trust this README:

```ts
import { DEFAULT_GUARDED_METHODS } from '@salimassili/ai-costguard';
// [ 'chat.completions.create', 'completions.create', 'responses.create', 'messages.create' ]
```

`getGuardState().requestCount` increments only for guarded calls, which makes it a cheap way to
confirm a path you expected to be covered actually is.

The full protected / not-protected table, including what a guarded call still does not cover, is in
[docs/COVERAGE.md](docs/COVERAGE.md).

To protect a custom client method:

```ts
const client = guard(customClient, {
  budget: 2,
  guardedMethods: ['agent.run'],
  pricingOverrides: [
    {
      model: 'internal-model',
      inputPer1kTokens: 0.001,
      outputPer1kTokens: 0.002,
      lastUpdated: '2026-08-23',
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

Every code the guard can throw, in the order you are likely to hit them:

| Code | Meaning |
| --- | --- |
| `BUDGET_EXCEEDED` | The reservation would push this scope past its budget. |
| `UNKNOWN_MODEL` | No pricing entry for this model. The message names the closest built-in sibling. |
| `OUTPUT_LIMIT_REQUIRED` | No output token limit on the request and no `defaultOutputTokens`. |
| `LOOP_DETECTED` | Too many near-identical recent prompts. |
| `RETRY_STORM_DETECTED` | Too many retry/failure prompts. |
| `MAX_STEPS_EXCEEDED` | This scope already used its `maxSteps` allowance. |
| `STREAMING_UNSUPPORTED` | `stream: true`. Streams are blocked, not charged — see below. |
| `SCOPE_LIMIT_EXCEEDED` | `maxScopes` reached. New scopes are blocked, never silently evicted. |
| `CONTEXT_INVALID` | The request could not be read as a model request. |
| `CONFIG_INVALID` | Invalid `GuardConfig`. Thrown at construction, not per request. |
| `SHARED_BUDGET_UNAVAILABLE` | `GuardPro` could not reach Redis. Fails closed; see [docs/SHARED-BUDGET.md](docs/SHARED-BUDGET.md). |

Branch on `error.code`, never on message text. Every `GuardError` also carries `error.metadata` with
`scopeKey`, `model`, `estimatedCostUsd`, `budgetLimitUsd`, `reservedCostUsd`, and `remainingUsd`.

### Why streaming is blocked rather than charged

A stream's real token count is not knowable before the call. Charging a guess would mean either
under-reserving (and blowing the budget) or refusing to guard streams at all. The guard rejects
`stream: true` with `STREAMING_UNSUPPORTED` before the budget test. If you need streaming, buffer the
response instead, or enforce the budget at the call site that starts the stream.

## Configuration

```ts
guard(client, {
  budget: {
    maxUsd: 10,
    thresholdPercent: 0.8,
  },
  projectId: 'production-api',
  runId: 'optional-agent-run',
  maxSteps: 100,
  behaviorAnalysis: true,
  maxHistory: 32,
  historyTtlMs: 5 * 60 * 1000,
  loopDetection: {
    similarityThreshold: 0.85,
    minHistorySize: 2,
    windowSize: 5,
  },
  retryThreshold: 2,
  defaultOutputTokens: 1000,
  scope: {
    projectId: 'production-api',
    userId: 'optional-user',
    sessionId: 'optional-agent-run',
  },
  alerts: {
    webhookUrl: process.env.COSTGUARD_WEBHOOK_URL,
    events: ['blocked', 'threshold'],
    timeoutMs: 1500,
    format: 'slack',
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
Top-level `projectId` and `runId` are convenience aliases for alert payloads and default scope values.
Scope identifiers are sensitive application data and are bounded to 256 characters. Process-local scope state is bounded by `maxScopes` (default: 10,000); exceeding the limit blocks new scopes rather than silently evicting budget state.

### `scopeIdleTtlMs`

A process that scopes requests by `sessionId` or `runId` will eventually fill `maxScopes`, because
every scope it has ever seen is still counted. After that, every new session is blocked with
`SCOPE_LIMIT_EXCEEDED` until the process restarts. `scopeIdleTtlMs` opts into reclaiming scopes that
have gone idle, and only when a genuinely new scope arrives at a full map:

```ts
const guard = guard(client, { budget: 25, maxScopes: 5_000, scopeIdleTtlMs: 3_600_000 });
```

The rules are deliberately narrow:

- Only scopes identified **purely** by `sessionId` or `runId` are eligible. `projectId` and `userId`
  scopes and the implicit `default` scope are never dropped, because their accumulated spend has to
  keep blocking.
- A scope must have been idle for longer than the TTL. An active session is never touched.
- The process-wide counters are never reset, so they still account for every dollar ever reserved.
  Only the per-scope balance is forgotten. `state.reclaimedScopeCount` reports how many scopes were
  dropped.

The cost of opting in is that an abandoned session that comes back after the TTL starts a fresh
per-session budget. Set the TTL to at least as long as a session is expected to live. Without this
option nothing is ever reclaimed and the previous fail-closed behavior is unchanged.

`budget` is a **per-scope** ceiling, not a per-process one. The process-wide counters are reporting
only: they are never consulted when deciding to block, so there is no process-wide spend cap behind
them. A caller that keeps introducing new `sessionId`/`runId` values can therefore spend more than
`budget` in total, because every new scope arriving at a full map can trigger another sweep that
reclaims up to `maxScopes` idle scopes. A fixed set of identifiers that recycles among itself is
bounded to `budget` per identifier per TTL window. If you need a hard process-wide ceiling, scope by
`projectId`/`userId` (never reclaimed) or use the shared-budget `GuardPro` path, where the total is
held in Redis and idle reclamation cannot apply.

### `defaultOutputTokens`

The guard must reserve output cost *before* the call, so it needs to know how many output tokens to
reserve. It reads that from `max_tokens`, `max_completion_tokens`, or `max_output_tokens` on the
request. When a request carries none of them, the call is **rejected** with
`OUTPUT_LIMIT_REQUIRED` rather than allowed uncosted.

If your SDK call shape has no output limit, set `defaultOutputTokens` to reserve a fixed amount
instead:

```ts
guard(client, {
  budget: 5,
  defaultOutputTokens: 2000, // reserve 2000 output tokens when the request does not say
});
```

This is a deliberate trade: you are choosing a fixed worst case over a per-request number. Too low
and the guard under-reserves; too high and it blocks calls that would have fit. `max_tokens` on the
request always wins over `defaultOutputTokens` when both are present.

## Loop Detection Tuning

Default loop detection uses character trigram cosine similarity with:

- `loopDetection.similarityThreshold: 0.85`
- `loopDetection.minHistorySize: 2`
- `loopDetection.windowSize: 5`

- Higher threshold, such as `0.95`: fewer false positives, but near-duplicate loops can slip through.
- Lower threshold, such as `0.75`: catches looser repeats, but unrelated prompts can be blocked.
- Higher `minHistorySize`: waits for more repeated prompts before blocking.
- Lower `minHistorySize`: blocks faster, but is more aggressive.
- Smaller `windowSize`: compares fewer recent prompts, reducing old-history false positives.
- Larger `windowSize`: compares more history, improving catch rate but increasing false-positive risk in repetitive workflows.

```ts
const openai = guard(client, {
  budget: 5,
  loopDetection: {
    similarityThreshold: 0.9,
    minHistorySize: 3,
    windowSize: 6,
  },
  scope: { sessionId: 'agent-run-123' },
});
```

Legacy `loopSimilarityThreshold` and `loopMinRepeats` config fields are still accepted, but `loopDetection` takes precedence. Loop detection is heuristic. Expect false positives and false negatives, especially for short prompts, templated prompts, and prompts that share a lot of boilerplate.

## Accounting Semantics

AI CostGuard is a conservative pre-call estimator, not a billing ledger. Read
[docs/ACCOUNTING.md](docs/ACCOUNTING.md) before relying on any of these numbers in a report.

- `estimatedCost`: the pre-call reservation for one request. **This is the only value tested against the budget.**
- `reservedCost`: running total of pre-call reservations. This is your budget balance.
- `blockedCost`: estimated cost refused before the provider was called. Never actual spend.
- `attemptedCost`: every evaluated request, allowed or blocked.
- `actualCost`: provider-reported usage. Observability only — never enforced.
- `totalCost`: **deprecated** alias of `reservedCost`, kept for compatibility. Use `reservedCost`.

The invariant `attemptedCost == reservedCost + blockedCost` holds at all times, for every scope and
the process-wide total, on the micro-cent grid these numbers are stored on. It is not a claim about
float bit patterns: the test suite asserts it with a `1e-12` tolerance, which is far tighter than the
1e-6 storage grid, across concurrent bursts, guards sharing one `GuardState`, and direct interleaving
of the core evaluator.

All money is stored and compared at micro-cent precision (1e-6 USD). This matters: twenty `$0.05`
requests sum to `0.9500000000000001` in raw floating point, and a naive comparison would then reject
the twentieth request even though it costs exactly the budget it was approved against. Rounding is
applied where money is added, so the stored balance, the comparison, and the reported totals can never
disagree. The ceiling is inclusive: an estimate that lands exactly on the remaining budget is allowed.

**Reservations are not refunded.** If the provider call later fails, the reservation stands, because
the guard cannot prove the provider did no billable work. A retry is therefore a second reservation,
not a free retry — which is why retry storms are detected separately.

`context.usageStatus` tells you how much to trust `context.actualCost`:

| Status | Meaning |
| --- | --- |
| `reported` | Both token counts recognized. `actualCost` is measured. |
| `partial` | One side recognized, the other fell back to the estimate. An upper bound. |
| `unavailable` | No recognizable usage fields. `actualCost` is unset; no cost is invented. |
| `skipped` | The request had no pricing entry, so no cost could be derived. |

A `usage` event fires in every one of those cases, so you can always tell "the provider reported
nothing" apart from "we never looked".

## Pricing

Known model pricing comes from built-in registry entries, runtime registrations, or per-guard overrides. Unknown models are blocked by default. Invalid pricing is rejected rather than converted to zero cost.

Pricing last verified: `2026-09-30`. **This is a dated, hand-maintained snapshot, not a live feed.**
AI CostGuard never fetches provider pricing. Each entry carries its own `lastUpdated`, so an entry you
could not re-check keeps an older date rather than being silently refreshed. When an entry is more
than 30 days old the package says so once at startup:

```text
[ai-costguard] 11 of 53 built-in pricing entries are older than 30 days (last checked 2026-09-30).
Built-in pricing is a hand-maintained snapshot (2026-09-30), not a live price feed. Verify a model
against its provider pricing page and override it when it differs.
```

Stale pricing never disables the guard and never allows an uncosted call. It means the *numbers* may
be off, so verify the models you actually rely on. Check it from code or from CI:

```ts
import { isBuiltInPricingStale, BUILTIN_PRICING_LAST_UPDATED, listBuiltInPricing } from '@salimassili/ai-costguard';

isBuiltInPricingStale();            // true when any entry is older than 30 days
BUILTIN_PRICING_LAST_UPDATED;       // '2026-09-30' — the most recent verification pass
listBuiltInPricing().length;        // 53 built-in entries
listBuiltInPricing()
  .filter((e) => e.lastUpdated !== BUILTIN_PRICING_LAST_UPDATED)
  .map((e) => e.model);             // the 11 that were not re-verified
```

```ts
import { getPricingMeta, registerPricing } from '@salimassili/ai-costguard';

registerPricing([
  {
    model: 'my-company-model',
    inputPer1kTokens: 0.001,
    outputPer1kTokens: 0.002,
    lastUpdated: '2026-08-23',
    source: 'internal',
  },
]);

console.log(getPricingMeta('gpt-4o-mini'));
```

Check built-in pricing freshness from CI or a release script:

```bash
aifw pricing --check-stale --days 30
```

The command exits `0` when all registry entries are within the threshold and `1` when one or more entries are stale.

If you intentionally want fallback pricing for unknown models:

```ts
guard(client, {
  budget: 5,
  unknownModelPolicy: 'fallback',
  unknownModelPricing: {
    model: 'fallback',
    inputPer1kTokens: 0.001,
    outputPer1kTokens: 0.002,
    lastUpdated: '2026-08-23',
    source: 'application fallback',
  },
});
```

Pricing changes frequently. Verify provider pricing before production use and override entries when needed.

## Token Counting Accuracy

AI CostGuard ships with a dependency-free token estimator so the root package stays small. It warns once per model/scope when approximate counting is used:

```text
[ai-costguard] Using approximate token counting for model: gpt-4o-mini. Register an exact tokenizer via registerTokenizer() for production use.
```

For production budgets that need tighter input-token estimates, register a provider tokenizer:

```ts
import { registerTokenizer } from '@salimassili/ai-costguard';

registerTokenizer('gpt-4o-mini', (text) => {
  return myTokenizer.encode(text).length;
});

registerTokenizer(/^claude-/u, (text) => {
  return myAnthropicTokenizer.count(text);
});
```

String patterns match model-name substrings case-insensitively. `RegExp` patterns are tested against the original model string. If a registered tokenizer throws or returns an invalid count, AI CostGuard falls back to the built-in approximation and keeps guarding the call.

## Events

```ts
const unsubscribe = openai.on('block', (event) => {
  console.log(event.code, event.reason, event.context.estimatedCost);
});

unsubscribe();
```

Supported events are `cost`, `allow`, `block`, and `usage`. A `usage` event is emitted after every
attempted post-call reconciliation, including the ones that could not measure anything, so
`event.context.usageStatus` always distinguishes "the provider reported nothing" from "we never
looked". It is not emitted for a call the guard blocked, because no provider call was made. Handler
errors are swallowed so observability code cannot change guard decisions.

## Slack / Webhook Alerts

Alerts are optional, local-first, and sent only to a webhook URL you provide. They are best-effort: failed or slow alert delivery never allows a blocked provider call, never replaces `GuardError`, and never crashes your app.
If `alerts.events` is omitted, only `blocked` alerts are sent. `threshold` alerts require `events: ['threshold']` or `events: ['blocked', 'threshold']` plus `budget.thresholdPercent` or `budget.thresholdUsd`.

```ts
import { guard } from '@salimassili/ai-costguard';

const safeClient = guard(openai, {
  budget: { maxUsd: 5, thresholdPercent: 0.8 },
  projectId: 'demo-agent',
  runId: 'run-2026-06-16',
  alerts: {
    webhookUrl: process.env.COSTGUARD_WEBHOOK_URL,
    events: ['blocked', 'threshold'],
    timeoutMs: 1500,
    format: 'slack',
  },
});
```

If `format` is omitted, AI CostGuard sends a redacted JSON payload:

```json
{
  "event": "blocked",
  "reason": "budget_exceeded",
  "severity": "critical",
  "projectId": "demo-agent",
  "runId": "run-2026-06-16",
  "model": "gpt-4",
  "provider": "openai",
  "estimatedCostUsd": 0.0306,
  "estimatedSavedUsd": 0.0306,
  "budgetLimitUsd": 5,
  "budgetUsedUsd": 4.99,
  "timestamp": "2026-06-16T00:00:00.000Z",
  "packageName": "@salimassili/ai-costguard"
}
```

For Slack incoming webhooks, use `format: 'slack'` or `slack: true`. AI CostGuard sends a Slack-compatible `{ "text": "..." }` body.

Alerts do not include raw prompts, request bodies, headers, API keys, environment variables, or webhook URLs. Do not commit webhook URLs; load them from environment variables or your secret manager. Alerts are not SaaS telemetry, a billing ledger, provider invoice reconciliation, or a hard security boundary.

Legacy `webhooks.slack`, `webhooks.discord`, `slackWebhook`, and `discordWebhook` block notifications remain supported for compatibility. New code should prefer `alerts`.

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

The event log is a local debugging tool, not a production log pipeline: each logged event costs a
synchronous `mkdirSync` + `appendFileSync` on the guarded call path, the file never rotates, and the
dashboard re-reads and re-parses the whole file on every request. Write failures are swallowed so they
can never affect a guard decision; read failures return HTTP 500 instead of crashing. Details in
[docs/DASHBOARD.md](docs/DASHBOARD.md#operational-caveats).

See `docs/DASHBOARD.md`.

## Integrations

Runnable mocked examples are included for:

- OpenAI SDK agent loop protection
- Anthropic SDK workflow budget guard
- Vercel AI SDK chatbot budget cap
- LangChain retry-storm prevention
- Mastra-style agent runner protection
- CrewAI launch/budget gate
- Local webhook and Slack alert mocks

See `docs/INTEGRATIONS.md` and `examples/integrations`.

## Express Middleware

The middleware attaches a manual checker. It does not automatically parse or inspect every route.

**The middleware trusts the numbers you hand it.** Unlike `guard()`, it cannot count tokens or look
up a price, so `model`, `tokens`, and `estimatedCost` are your assertions, not measured values. The
budget check only tests `estimatedCost`, so a caller who passes a too-small number gets a too-large
budget. Derive `estimatedCost` server-side — from `getPricing(model)` and your own token count — and
never let it come from a request body, query string, or header. `scopeKey` is likewise
caller-supplied; the guard treats it as an opaque budget bucket, so derive it from a trusted session
or tenant identifier rather than anything the client controls.

```ts
import { middleware, GuardError } from '@salimassili/ai-costguard';

app.use(middleware({ budget: 2 }));

app.post('/chat', async (req, res, next) => {
  try {
    req.localSafety.check({
      model: 'gpt-4o-mini',
      pricingKnown: true,
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

## Running More Than One Process

`guard()` enforces its budget in the memory of one process. That is exact for concurrent in-process
callers — including guards that share one `GuardState` — and it is not exact across replicas,
containers, or `worker_threads`, each of which gets its own balance.

For a single budget across processes, `GuardPro` enforces it in Redis with an atomic check-and-charge.
It is MIT licensed, ships in this same package at `@salimassili/ai-costguard/pro`, and has no license
check. `ioredis` is an optional peer you install yourself.

See [docs/SHARED-BUDGET.md](docs/SHARED-BUDGET.md) for the decision table, the fail-closed behavior,
and the operational checklist.

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

`check` prints JSON. Besides `ok` and the cost it reports **which pricing entry it used**, because a
budget gate that silently prices an unfamiliar model name from a family prefix is gating on an
assumed number:

```json
{
  "ok": true,
  "model": "gpt-4.1-turbo",
  "maxSteps": 1,
  "estimatedCostUsd": 0.008,
  "budgetUsd": 100,
  "pricingModel": "gpt-4.1",
  "pricingMatch": "family-prefix",
  "pricingOrigin": "builtin"
}
```

`pricingMatch: "family-prefix"` with `pricingModel` different from `model` means the registry has no
entry for the name you passed. Treat that as a warning in CI, or pass
`--input-price-per-1k`/`--output-price-per-1k` to pin the price. See
[docs/ACCOUNTING.md](docs/ACCOUNTING.md#family-prefix-fallback-a-name-that-looks-unknown-is-often-priced-anyway).

## Benchmarks

Run local benchmarks:

```bash
npm run build
npm run benchmark
```

The script reports runtime overhead, approximate heap delta, false-positive scenarios, loop detection behavior, and cost-estimation boundaries. Results are local measurements, not universal guarantees. See `docs/BENCHMARKS.md`.

Latest local benchmark in this repo on Node `v24.14.1` / Windows measured `0.029952 ms` added per mocked guarded call over `5000` iterations. That number is a difference of two wall-clock totals and it is noisy: six consecutive runs of the same binary landed between `0.021158` and `0.042931` ms, median `0.025101` ms. The measured heap delta for `2000` calls ranged from `64,944` to `3,034,664` bytes across the same six runs because GC was not exposed. Quote a range, not a single decimal, and re-run on your target runtime before using it in performance-sensitive claims.

Token accuracy benchmark, fixed proxy corpus: average error `9.68%`, median error `11.43%`, max error `28.57%`, `24` samples. The dependency-free estimator is a rough guardrail, not provider-tokenizer parity. Register an exact tokenizer for production use when token accuracy matters.

## Why Not 50 Lines Of Code?

A simple homemade budget check can stop one request after one counter crosses one number. AI CostGuard packages the parts that usually become messy once agents enter production:

- Provider pricing registry with runtime overrides and unknown-model blocking.
- Structured `GuardError` codes and metadata for API responses.
- Scoped budget and behavior state per project, user, or session.
- TTL-bounded prompt history.
- Loop and retry-storm detection.
- Estimated, attempted, blocked, and actual usage accounting on a consistent money scale.
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
npm run benchmark:tokens
npm audit --omit=dev
npm pack --dry-run
```

## What Is Actually Guaranteed

Precise claims, because "it stops runaway costs" is too coarse to be useful.

**Guaranteed.** Concurrent in-process callers cannot overspend a shared budget. `check()` is fully
synchronous — no `await`, no I/O between the budget test and the reservation write — so a second
caller always observes the first caller's reservation. This covers any number of `Promise.all`
callers in one process, and guards that share one `GuardState`. It is verified with 40 concurrent
requests in `test/accounting.test.mjs`.

**Guaranteed.** A blocked request never reached your provider. The throw happens before the client
method is invoked, and the tests assert on the provider's own call counter rather than on guard
internals.

**Guaranteed.** No call is allowed with a *zero* cost for lack of a decision. An unknown model, a
missing output limit, and a price that would evaluate to 0/0 are all blocked rather than treated as
free. The three ways a reservation can still be wrong are the ones above it: a family-prefix price
guess, a caller-supplied `estimatedCost` through `middleware()`, and an approximate token count.

**Not guaranteed.** That the model name was priced exactly. A `-`/`:` suffix falls back to the
nearest family entry, so `gpt-4o-realtime-preview` is costed at the `gpt-4o` rate. Check
`getPricingMeta(m)?.match === 'exact'` to assert this, and register a price to pin it. See
[docs/ACCOUNTING.md](docs/ACCOUNTING.md#family-prefix-fallback-a-name-that-looks-unknown-is-often-priced-anyway).

**Not guaranteed.** Anything across a process boundary. Separate processes, `worker_threads`, and
serverless isolates each hold their own balance. Use [docs/SHARED-BUDGET.md](docs/SHARED-BUDGET.md).

**Not guaranteed.** That the estimate matches your bill. Input tokens are approximated and prices are
a dated snapshot. Both err toward over-reserving, never toward allowing an uncosted call.

**Not guaranteed.** Loop and retry detection. Both are heuristics over character trigrams, and both
produce false positives and false negatives. Tune them, and do not treat them as a correctness
boundary.

**Not guaranteed.** That alerts were delivered. Webhooks are fire-and-forget with a timeout. A failed
alert never changes a decision and never crashes your app.

## Limitations

- Token counting is approximate and dependency-free unless you register an exact tokenizer.
- Token estimation is intentionally conservative and can overestimate materially; see the token accuracy benchmark.
- Built-in pricing is a dated snapshot and goes stale; override it for production.
- The guard is process-local. Cross-process enforcement needs a shared store.
- Streaming requests are blocked rather than charged.
- Only the listed SDK method paths are guarded; raw `fetch` and other HTTP clients are not intercepted.
- Loop detection uses character trigram similarity, not embeddings.
- Retry detection is heuristic.
- Webhooks are best-effort and never affect enforcement.
- The dashboard reads local JSONL logs only; it is not a hosted analytics product.
- Provider usage reconciliation only works when responses expose recognizable `usage` fields.

## Documentation

- [docs/ACCOUNTING.md](docs/ACCOUNTING.md) — what each number means and when to trust it
- [docs/COVERAGE.md](docs/COVERAGE.md) — the full protected / not-protected table
- [docs/SHARED-BUDGET.md](docs/SHARED-BUDGET.md) — one budget across processes
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — framework wiring
- [docs/DASHBOARD.md](docs/DASHBOARD.md) — local spend visibility
- [docs/BENCHMARKS.md](docs/BENCHMARKS.md) — measured overhead
- [START-HERE.md](START-HERE.md) — repository layout and orientation
- [ARCHITECTURE.md](ARCHITECTURE.md) — design rationale
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute
- [SECURITY.md](SECURITY.md) — how to report a vulnerability

## License

MIT. See [LICENSE](./LICENSE).
