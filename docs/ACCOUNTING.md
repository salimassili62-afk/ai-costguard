# Accounting

Every number this package exposes, what it means, and when you should not trust it. The goal is
that you can answer "how much have I spent?" and "why was this call blocked?" without reading the
source.

## The three cost numbers

| Field | Meaning | Enforced? |
| --- | --- | --- |
| `estimatedCost` | Pre-call reservation. What the guard decided to set aside. | **Yes.** This is the only value tested against the budget. |
| `reservedCost` | Running total of pre-call reservations. | This is the budget balance. |
| `actualCost` | Running total of provider-reported usage. | No. Observability only. |

`totalCost` is a deprecated alias of `reservedCost`. It is kept for backwards compatibility and will
equal `reservedCost` exactly. New code should read `reservedCost`.

## The invariant

```
attemptedCost == reservedCost + blockedCost
```

This holds for every scope and for the process-wide total, at every point in time, under any
interleaving. `attemptedCost` counts every request that reached an evaluation; `reservedCost` is
what was committed; `blockedCost` is what was refused. Nothing is ever dropped or double-counted.

The equality is exact **on the micro-cent grid that stores these numbers**, which is what the package
rounds to anyway. It is not a claim about IEEE-754 bit patterns: adding two already-rounded totals
can land one binary ULP away from a third, so a literal `===` in your own code can read `false` by
about 2e-16. The test suite therefore asserts the identity with a `1e-12` tolerance — four orders of
magnitude tighter than the storage grid, and seven orders tighter than a cent.

Two consequences worth knowing:

- A blocked request still increments `attemptedCost` and `blockedCost`, and still increments
  `blockedCount`. A block is a real outcome, not a non-event.
- `requestCount` counts allowed requests only. It is the count of calls that actually reached your
  provider. `requestCount + blockedCount` is the number of requests you asked the guard about.

## Money precision

All money is stored and compared at **micro-cent precision** (6 decimal places, 1e-6 USD).

Rounding happens at a single point, when money is added. This is not cosmetic. Raw IEEE-754
addition of many small estimates accumulates visible drift: twenty $0.05 requests sum to
`0.9500000000000001`, and a naive `reserved + estimated <= budget` test would then reject the
twentieth request even though it costs exactly the budget it was approved against. Adding on the
rounded scale keeps the stored value, the budget comparison, and the reported totals on one
consistent scale, so they can never disagree.

The budget ceiling is **inclusive**: a request whose estimate lands exactly on the remaining budget
is allowed. `$1.00` budget, three `$0.40` reservations: the first two are allowed, the third is
blocked.

## Reservation vs actual usage

A reservation is a pre-call decision. It is deliberately not a refund.

**Reconciliation is observability only.** It never refunds a reservation, never shrinks a balance,
and never reverses an earlier allow. This is intentional: once a reservation is committed, the guard
has no way to prove the provider did not perform billable work. A refund would hand back budget
that was genuinely spent, which is the exact failure a budget enforcer must not have.

`recordActualUsage()` runs at most once per request context. Later calls for the same context are
ignored, so a response you pass twice is never counted twice.

### Usage status

`context.usageStatus` tells you how much to trust `context.actualCost`:

| Status | When | `actualCost` |
| --- | --- | --- |
| `reported` | Both input and output token counts recognized. | Computed from provider numbers. |
| `partial` | Only one side recognized; the missing side falls back to the pre-call estimate. | An upper bound, not a measurement. |
| `unavailable` | No recognizable usage fields in the response. | Unset. No cost is invented. |
| `skipped` | The request had no pricing entry, so no cost can be derived. | Unset. |

A `usage` event is emitted in every one of these cases, including `unavailable`. Silence is never
used to mean "fine": if you are reconciling spend, you can tell the difference between "the provider
reported nothing" and "we never looked".

```ts
guarded.on('usage', (event) => {
  if (event.context.usageStatus === 'unavailable') {
    metrics.increment('costguard.usage_missing');
  }
});
```

### Provider failure keeps the reservation

If your provider call throws after the reservation was committed, the reservation stands. The guard
cannot distinguish "the request never left the process" from "the provider billed you and then
failed", and it fails toward the budget being real. `blockedCost` and `blockedCount` are **not**
incremented, because a provider failure is not a block.

The practical consequence: a retry after a failure is a second reservation, not a free retry. This
is why retry storms are detected and blocked separately.

## Estimating the pre-call cost

```
estimatedCost = (inputTokens / 1000) * inputPer1kTokens
              + (outputTokens / 1000) * outputPer1kTokens
```

Input tokens are estimated from the request body; output tokens must come from the request
(`max_tokens`, `max_completion_tokens`, `max_output_tokens`) or from `guard({ defaultOutputTokens })`.
A request with neither is rejected with `OUTPUT_LIMIT_REQUIRED` rather than allowed uncosted.

A request with no recognizable output limit cannot be costed safely, so the guard refuses it. This is
the one place where the default is "no" rather than "assume something reasonable".

**Input tokens are approximate.** The built-in estimator is calibrated for ordinary English prose and
deliberately over-estimates, because a budget enforcer should round against itself. It does not
understand code, base64, or non-Latin scripts. The first time it estimates for a given model and
scope it warns once:

```
[ai-costguard] Using approximate token counting for model: gpt-4o-mini. Register an exact tokenizer via registerTokenizer() for production use.
```

Register an exact tokenizer when the estimate has to be tight:

```ts
import { registerTokenizer } from '@salimassili/ai-costguard';
import { encoding_for_model } from 'tiktoken';

const enc = encoding_for_model('gpt-4o-mini');
registerTokenizer(/^gpt-4o-mini/u, (text) => enc.encode(text).length);
```

A tokenizer that throws falls back to the approximate count and keeps working. It is never allowed
to take down a request.

## Unknown models

A model whose name matches no built-in entry and no registered price is **blocked**, not allowed
uncosted. The verbatim error for a name with no family in the registry:

```
No pricing found for model "claude-haiku-4.5". AI CostGuard blocks unknown models by default because an uncosted call cannot be budgeted safely. Register the price with registerPricing([...]) or pass guard({ pricingOverrides: [...] }).
```

When the unknown name is a prefix-extension of a built-in family, the message also names the closest
entry and its prices:

```
No pricing found for model "gpt-4o.5". AI CostGuard blocks unknown models by default because an uncosted call cannot be budgeted safely. Register the price with registerPricing([...]) or pass guard({ pricingOverrides: [...] }). The closest built-in entry is "gpt-4o" (input $0.005/1k, output $0.015/1k, checked 2026-08-23); reuse those values only if they are correct for this model.
```

The closest entry is found by shared model-family prefix and is only a starting point. The message
tells you so, because copying a sibling's price is right often enough to be a useful first move and
wrong often enough that it must not be silent.

### Family-prefix fallback: a name that looks unknown is often priced anyway

Before a model is called unknown, the registry tries a **family-prefix match**. If the requested name
starts with a built-in name plus `-` or `:`, it is costed at that entry's price, longest family first:

| Requested | Priced as | `match` |
| --- | --- | --- |
| `gpt-4.1` | `gpt-4.1` | `exact` |
| `gpt-4.1-turbo` | `gpt-4.1` | `family-prefix` |
| `gpt-5-ultra` | `gpt-5` | `family-prefix` |
| `o3-pro` | `o3` | `family-prefix` |
| `claude-sonnet-4-5-20260101` | `claude-sonnet-4-5` | `family-prefix` |
| `claude-haiku-4.5` | *(none)* | *(blocked)* |
| `totally-made-up-model` | *(none)* | *(blocked)* |

This is deliberate for dated model snapshots, where a new date on an existing model genuinely has the
same price. It also means a model the registry has never heard of can be costed at a **guessed**
price. `o3-pro` is priced here at the `o3` rate, which is not the real `o3-pro` rate, so the
reservation can under- or over-count against a real invoice. The call is still costed and the budget
still moves; what changes is how much you should trust the number.

`getPricingMeta()` makes the distinction checkable:

```ts
import { getPricingMeta } from '@salimassili/ai-costguard';

const meta = getPricingMeta('o3-pro');
meta?.match;        // 'family-prefix'
meta?.pricing.model // 'o3'  — the entry that was actually used
meta?.origin;       // 'builtin'
```

To assert that a model is priced from a verified entry rather than a guess, check `match === 'exact'`
at startup. To pin a specific price regardless of the fallback, register it.

Register the real price you verified:

```ts
import { registerPricing } from '@salimassili/ai-costguard';

// Your provider really does publish this model under a slightly different name than the registry
// snapshot has, or you verified a price that has since changed. Register the number you checked.
registerPricing([
  {
    model: 'internal-llm-router-v2',
    inputPer1kTokens: 0.00012,
    outputPer1kTokens: 0.0004,
    lastUpdated: '2026-09-27',
    source: 'https://internal.example.com/llm-pricing',
  },
]);
```

`pricingOverrides` on the guard config is the per-instance equivalent and is validated up front, so
a malformed override fails at startup rather than at the first expensive request.

Setting `unknownModelPolicy: 'fallback'` with `unknownModelPricing` makes unknown models use a
deliberate default price instead of blocking. Use it only if a uniform worst-case price is an
acceptable answer for every model you have not priced.

## Built-in pricing is a snapshot, not a feed

The built-in table is hand-maintained and versioned in the source. **Nothing in this package fetches
pricing from a provider**, and it never will without you asking.

The snapshot carries a `lastUpdated` date. Older than 30 days, the package says so once at import:

```
[ai-costguard] 25 of 25 built-in pricing entries are older than 30 days (last checked 2026-08-23).
Built-in pricing is a hand-maintained snapshot, not a live price feed. Verify a model against its
provider pricing page and override it when it differs.
```

This is a disclosure, not a nag. A guard whose prices silently drift is worse than one that admits
its prices are old. Check it yourself at any time:

```ts
import { isBuiltInPricingStale, BUILTIN_PRICING_LAST_UPDATED, listBuiltInPricing } from '@salimassili/ai-costguard';

isBuiltInPricingStale();              // true when the snapshot is older than 30 days
BUILTIN_PRICING_LAST_UPDATED;         // '2026-08-23'
listBuiltInPricing().length;          // every built-in entry
```

```bash
npx ai-costguard pricing --check-stale   # exit 1 when stale, for a CI gate
```

Stale pricing does not disable the guard. It means the *numbers* may be off, so verify the models you
actually rely on and override them. A wrong price produces a wrong budget, never an uncosted call.

## See also

- [COVERAGE.md](COVERAGE.md) — which calls are costed at all
- [SHARED-BUDGET.md](SHARED-BUDGET.md) — one budget across processes
- [DASHBOARD.md](DASHBOARD.md) — reading these numbers in a UI
