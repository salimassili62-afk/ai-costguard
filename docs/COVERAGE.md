# Guard Coverage

What this package costs, what it does not cost, and why. If a call is not listed as protected here,
it is **not** charged to your budget and **not** blocked. Nothing in this package silently
intercepts traffic: coverage is a property of the method paths you wrap, and you can always read it
from the exported list.

## Default protected method paths

`guard(client, config)` evaluates only these method paths unless you pass `guardedMethods`:

| Provider | Protected path |
| --- | --- |
| OpenAI (chat) | `chat.completions.create` |
| OpenAI (legacy) | `completions.create` |
| OpenAI (responses) | `responses.create` |
| Anthropic (messages) | `messages.create` |

The list is exported, so you can assert on it rather than trusting this document:

```ts
import { DEFAULT_GUARDED_METHODS } from '@salimassili/ai-costguard';

console.log(DEFAULT_GUARDED_METHODS);
// [ 'chat.completions.create', 'completions.create', 'responses.create', 'messages.create' ]
```

## Not protected

Everything else on a wrapped client is forwarded to the original method untouched:

- `chat.audio.transcriptions.create`, `chat.audio.translations.create`, and other audio paths
- `embeddings.create`, `images.generate`, `moderations.create`
- `files.*`, `batches.*`, `fine_tuning.*`, `models.*`, `uploads.*`
- `close()`, and any other teardown or administrative method
- Raw `fetch`, `http.request`, `axios`, or any other HTTP client

**Not intercepted at all.** This package is an in-process proxy, not a network interceptor. It does
not patch `globalThis.fetch`, does not install a loader hook, and cannot see HTTP traffic your code
makes by any other route. If you need a request costed, wrap the specific call that makes it.

## Extending coverage

Pass exact dot-separated method paths. A custom path is evaluated by the same code as a default one,
including scope accounting, the budget test, and pricing resolution:

```ts
const guarded = guard(agentClient, {
  budget: 1,
  guardedMethods: ['chat.completions.create', 'agent.run'],
});
```

Paths are matched against the full path from the client root, separated by `.`. There is no glob, no
regex, and no prefix matching: `agent.run` guards that method, and `agent` guards a callable
property named `agent`. Nesting deeper than the actual method name silently guards nothing, so
verify a custom list against your client once at startup.

`guardFunction(fn, config)` is the single-function form. It guards exactly that one function and
nothing else. The first argument is the function itself, never a client; the method name used for
matching comes from `config.guardedMethods[0]` and defaults to `run`:

```ts
const summarize = guardFunction(callMyModel, { budget: 1 });
const summarize = guardFunction(callMyModel, { budget: 1, guardedMethods: ['chat.completions.create'] });
```

A method name that collides with a guard control (`on`, `off`, `getGuardState`) is safe: the
function is parked one level below the root proxy, so the guard's subscription API never shadows it.

## What a protected call still does not cover

Protection is a budget decision, not a transaction. Specifically:

- **Streaming is blocked, not charged.** A request with `stream: true` is rejected with
  `STREAMING_UNSUPPORTED` before the budget test, because final token counts are not knowable
  before the call and the guard will not reserve on a guess. The block is the safety behavior.
- **Only one request body shape is interpreted.** Context is extracted from the first argument.
  Call-signature variants that do not pass a request object with `model` are rejected with
  `UNKNOWN_MODEL` rather than allowed uncosted.
- **An output token limit is required.** Without `max_tokens` / `max_completion_tokens` /
  `max_output_tokens` and without `guard({ defaultOutputTokens })`, the call is rejected with
  `OUTPUT_LIMIT_REQUIRED`. Set `defaultOutputTokens` if you accept a fixed reservation instead.
- **Unknown models are blocked, not free.** By default a model with no pricing entry is rejected
  with `UNKNOWN_MODEL` and the message names the closest built-in sibling. See
  [ACCOUNTING.md](ACCOUNTING.md#unknown-models) for how to register prices.
- **Actual spend is not enforced.** The budget is enforced against a pre-call reservation.
  Reconciliation from provider-reported usage is observability only and never adjusts a budget or
  reverses a decision. See [ACCOUNTING.md](ACCOUNTING.md#reservation-vs-actual-usage).

## Verifying coverage yourself

```ts
const guarded = guard(client, { budget: 1 });

// Wrapped, and therefore protected.
await guarded.chat.completions.create({ model: 'gpt-4o-mini', max_tokens: 100, messages: [] });

// Forwarded untouched, and therefore NOT charged.
await guarded.embeddings.create({ model: 'text-embedding-3-small', input: 'hello' });

guarded.getGuardState().requestCount; // 1, not 2
```

`getGuardState().requestCount` increments only for protected calls, so it is a cheap way to confirm
that a path you expected to be covered actually is.

## See also

- [ACCOUNTING.md](ACCOUNTING.md) — what the numbers mean, and when they are trustworthy
- [SHARED-BUDGET.md](SHARED-BUDGET.md) — enforcing one budget across processes
- [INTEGRATIONS.md](INTEGRATIONS.md) — framework-specific wiring
