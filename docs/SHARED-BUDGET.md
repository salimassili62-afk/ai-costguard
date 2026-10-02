# Shared Budgets Across Processes

`guard()` enforces its budget **in the memory of one Node.js process**. That is fast, has no
dependencies, and needs no infrastructure — and it is exactly as strong as "one process". If you run
more than one replica, each one has its own balance and N replicas can spend N times the budget.

This page is about the two ways to fix that, and about honestly describing whichever one you pick.

## Do I need this?

| Deployment | `guard()` alone is enough? |
| --- | --- |
| Single process, single host | **Yes.** |
| Multiple processes **sharing one `GuardState`** | **Yes.** See below. |
| Several replicas, containers, or serverless instances | **No.** Use a shared store. |
| `worker_threads` or `cluster` workers | **No.** Separate address spaces. |

## Option 1: share one `GuardState` in-process

If your concurrency is several async tasks, several clients, or several `worker_threads` *sharing an
address space* through a single module instance, pass the same state object to every guard. They then
contend for one reservation pool:

```ts
import { guard, createGuardState } from '@salimassili/ai-costguard';

const sharedState = createGuardState();

const openai = guard(openaiClient, { budget: 25 }, sharedState);
const anthropic = guard(anthropicClient, { budget: 25 }, sharedState);
```

`sharedState` is the **third positional argument**, not a config key. Passing it inside the config
object silently does nothing and gives you two independent budgets, which is the failure this page
exists to prevent.

Because `GuardCore.check()` is fully synchronous — no `await`, no I/O between the budget test and the
reservation write — concurrent in-process callers cannot both pass the budget test and then race to
commit. This is guaranteed, not best-effort. It is verified directly in `test/accounting.test.mjs`
with 40 concurrent requests and a shared-state contention test.

This does **not** cross an address-space boundary. Separate processes do not share a JS object.

## Option 2: a shared store (`GuardPro`)

`GuardPro` enforces one budget in Redis. The check and the charge happen in a single atomic Lua
script, so there is no read-then-write window between processes.

`ioredis` is an optional peer: it is **not** installed for you and the core package does not depend
on it.

```bash
npm install @salimassili/ai-costguard ioredis
```

```ts
import { GuardPro } from '@salimassili/ai-costguard/pro';

const pro = new GuardPro({
  redisUrl: process.env.REDIS_URL!,
  budget: { maxUsd: 25, windowSeconds: 86_400 },
});

await pro.checkAndCharge('tenant-abc', 0.0042);
```

`checkAndCharge()` throws `GuardError` with code `BUDGET_EXCEEDED` when the request would exceed the
project budget. Each `projectId` gets its own key, so tenants are isolated by construction.

### Exact six-decimal accounting

The script compares **integer micro-dollars**, not floats, so the budget boundary is exact. A charge
that lands precisely on the budget is allowed:

```ts
const pro = new GuardPro({ redisUrl, budget: 0.3 });
await pro.checkAndCharge('tenant-abc', 0.2);
await pro.checkAndCharge('tenant-abc', 0.1); // allowed: total is exactly $0.30
```

Redis float arithmetic would reject that second call, because `0.2 + 0.1` evaluates to
`0.30000000000000004`. Amounts are rounded to six decimal places to match the in-process
`GuardCore` ledger, so shared and local accounting agree at the boundary.

The stored value stays a human-readable decimal string (`"0.3"`) rather than an opaque integer, so
existing keys keep working. Spend written by earlier releases, including float-drifted values such as
`0.30000000000000004`, is normalized on the next charge. An unreadable or out-of-range value fails
closed with `SHARED_BUDGET_UNAVAILABLE` instead of silently resetting a tenant's spend to zero.

The exact script is executed against a real Lua interpreter in `test/guard-pro-lua.test.mjs`, which
checks the boundary, drift across thousands of micro-dollar charges, legacy values, and TTL
behavior. Set `COSTGUARD_REDIS_URL` to also run the same assertions against a live Redis.

`GuardPro` lives at `@salimassili/ai-costguard/pro`. It is MIT-licensed, ships in the same npm
package, and has **no license check, no activation, and no network call to any vendor**. There is no
paid tier and no second runtime to install.

### Fails closed

If Redis is unreachable and `allowLocalFallback` is not set, every call throws
`SHARED_BUDGET_UNAVAILABLE`:

```
Shared budget enforcement is unavailable for project "tenant-abc".
```

This is the correct default. The alternative — quietly falling back to a per-process budget — would
mean a Redis outage silently multiplies your spend by the number of replicas, which is the opposite
of what a budget guard is for. If your availability requirements genuinely demand best-effort
behavior, opt in explicitly:

```ts
const pro = new GuardPro({
  redisUrl: process.env.REDIS_URL!,
  budget: { maxUsd: 25 },
  allowLocalFallback: true,
});
```

`allowLocalFallback: true` is **not** shared enforcement and must not be described as one, in your
code, your runbook, or your postmortem. It means each process enforces its own independent budget and
the real total is unguarded. It is a deliberate availability-over-correctness trade.

### Lifecycle

`GuardPro` pools one Redis client per `redisUrl` and reuses it across instances. Call `shutdown()`
during graceful termination to close the pool:

```ts
process.on('SIGTERM', async () => {
  await pro.shutdown();
  process.exit(0);
});
```

## Handling errors by code

Both entry points fail closed and both tell you why through `GuardError.code`. Branch on the code
rather than on the message text:

```ts
import { GuardError } from '@salimassili/ai-costguard';

try {
  await pro.checkAndCharge(tenantId, cost);
} catch (error) {
  if (!(error instanceof GuardError)) throw error;

  switch (error.code) {
    case 'BUDGET_EXCEEDED':
      return respond(429, 'Daily budget reached.');
    case 'SHARED_BUDGET_UNAVAILABLE':
      // Fail closed, but this is an infrastructure problem, not a user problem.
      metrics.increment('costguard.shared_budget_unavailable');
      return respond(503, 'Budget enforcement unavailable, request not sent.');
  }
}
```

Every `GuardError` also carries a `metadata` object with `code`, `reason`, `context`, `scopeKey`, `similarity?`,
`model`, `estimatedCostUsd`, `budgetLimitUsd`, `reservedCostUsd`, and `remainingUsd`, so an alert can be built without
re-deriving the numbers.

## Operational checklist

- Set a finite, positive `windowSeconds`. The default is 86 400 (one day).
- Keep `REDIS_URL` and webhook URLs in your deployment secret manager, never in source.
- Keep tenant identifiers normalized and opaque. Do not put secrets or raw prompts in a `projectId`:
  it becomes part of a Redis key.
- Decide your `allowLocalFallback` posture explicitly and write down which one you chose.
- Verify provider pricing and register overrides where contract pricing differs. See
  [ACCOUNTING.md](ACCOUNTING.md).
- Register an exact tokenizer where approximate counting is not precise enough.
- Alert on `SHARED_BUDGET_UNAVAILABLE` separately from `BUDGET_EXCEEDED`. They mean opposite things:
  one is "you spent too much", the other is "I could not tell".

## See also

- [ACCOUNTING.md](ACCOUNTING.md) — the numbers behind the budget decision
- [COVERAGE.md](COVERAGE.md) — which calls are costed
- [DASHBOARD.md](DASHBOARD.md) — local spend visibility
