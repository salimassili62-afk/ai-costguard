# AI CostGuard Production Kit

The Production Kit is one self-serve $199 one-time purchase for teams deploying Node.js AI agents. It is operational material built around the free MIT `@salimassili/ai-costguard` runtime. It does not add runtime restrictions, license checks, DRM, a private npm package, or a hosted service.

[Get AI CostGuard Pro](https://aicostguard.lemonsqueezy.com/checkout/buy/8801cd1c-d7ea-4df8-a2e7-e54565f32e65)

## Redis Shared Budgets

Install the free package and Redis client:

```bash
npm install @salimassili/ai-costguard ioredis
```

Initialize `GuardPro` from the `/pro` subpath. It has no runtime license check. Redis is required for shared enforcement and failures are closed by default:

```ts
import { GuardPro } from '@salimassili/ai-costguard/pro';

const pro = new GuardPro({
  redisUrl: process.env.REDIS_URL ?? '',
  budget: { maxUsd: 25, windowSeconds: 86400 },
});

await pro.checkAndCharge('tenant-abc', 0.0042);
```

`checkAndCharge()` atomically reserves allowed spend in Redis and throws `GuardError` with code `BUDGET_EXCEEDED` when the request would exceed the project budget. Redis failure throws `SHARED_BUDGET_UNAVAILABLE` by default; it never silently becomes shared enforcement backed by independent local state.

For explicitly best-effort local fallback, set `allowLocalFallback: true`. That mode is not shared enforcement and must not be described as a cross-process safety boundary.

## Multi-Tenant Isolation

Use a stable tenant or project identifier as the `projectId` passed to `checkAndCharge()`. Each identifier receives a separate Redis key:

```ts
await pro.checkAndCharge(`tenant-${tenantId}`, estimatedCost);
```

Keep tenant identifiers normalized and opaque. Do not put secrets or raw prompts in identifiers.

## CI Budget Gates

Use the package CLI to fail a build when a planned workload exceeds its budget:

```bash
npx aifw check --budget 1 --model gpt-4o-mini --input-tokens 500 --tokens 1000 --max-steps 5
```

Exit codes are `0` for an allowed projection, `1` when the projection exceeds the budget, and `2` for invalid command usage or configuration.

## Production Checklist

- Verify provider pricing and register overrides when contract pricing differs.
- Register an exact tokenizer when approximate counts are not sufficient.
- Keep `REDIS_URL` and webhook URLs in the deployment secret manager.
- Set a finite, positive `windowSeconds` value.
- Handle `GuardError` by code at the application boundary.
- Run the CI budget gate for representative workloads.
- Call `shutdown()` during graceful process termination.

The repository contains public reference examples. The purchased Production Kit must be treated as a separately versioned operational deliverable; do not claim a recipe or deployment pattern is included until it exists in that delivered artifact. See [PRO_FEATURES.md](PRO_FEATURES.md) for the current documented scope.
