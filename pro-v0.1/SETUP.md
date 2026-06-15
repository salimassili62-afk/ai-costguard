# AI CostGuard Pro — Redis / GuardPro Setup

This guide covers installing `ioredis`, configuring environment variables, and initializing `GuardPro` for Redis-backed shared budget enforcement.

> **Note**: Redis is optional. The free process-local `guard()` works without Redis. Use `GuardPro` when you need to share a budget across multiple Node.js processes, workers, or server instances.

---

## 1. Install dependencies

```bash
# Public package (required)
npm install @salimassili/ai-costguard

# Redis client (required for GuardPro)
npm install ioredis
```

---

## 2. Set environment variables

```bash
# .env (or your deployment secret manager)
REDIS_URL=redis://localhost:6379

# Optional: block notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

---

## 3. Initialize GuardPro

`GuardPro` is exported from the `/pro` subpath. It does **not** load when you import from the root package.

```ts
import { GuardPro } from '@salimassili/ai-costguard/pro';

const pro = new GuardPro({
  redisUrl: process.env.REDIS_URL ?? '',
  budget: 25,             // USD budget for each project window
  windowSeconds: 86400,  // 24-hour window (default)
  slackWebhook: process.env.SLACK_WEBHOOK_URL,
  discordWebhook: process.env.DISCORD_WEBHOOK_URL,
});
```

### GuardProConfig reference

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `redisUrl` | `string` | Yes | — | ioredis connection URL |
| `budget` | `number` | Yes | — | USD budget per project per window |
| `windowSeconds` | `number` | No | `86400` | TTL in seconds for each spend key |
| `slackWebhook` | `string` | No | — | Slack incoming webhook URL for block notifications |
| `discordWebhook` | `string` | No | — | Discord webhook URL for block notifications |
| `webhooks` | `GuardWebhookConfig` | No | — | Combined webhook config (takes precedence) |
| `redisClient` | `GuardProRedisClient` | No | — | Inject a custom Redis-compatible client (useful for tests) |

---

## 4. Charge spend and enforce budget

```ts
// Before an AI API call, estimate cost and charge it.
// GuardPro throws GuardError('...', context, 'BUDGET_EXCEEDED') if over budget.
await pro.checkAndCharge('tenant-abc', 0.0042);
```

`checkAndCharge(projectId, estimatedCost)`:
- Atomically increments spend in Redis using a Lua script with INCRBYFLOAT.
- Sets a TTL on the key if one is not already set.
- Falls back to process-local tracking automatically when Redis is unreachable.
- Throws `GuardError` with code `BUDGET_EXCEEDED` when spend exceeds budget.

---

## 5. Read and reset spend

```ts
const spent = await pro.getSpend('tenant-abc');
console.log(`Current spend: $${spent.toFixed(6)}`);

// Reset a tenant's spend (e.g. on billing cycle rollover)
await pro.resetSpend('tenant-abc');
```

---

## 6. Check connection status

```ts
if (!pro.isConnected()) {
  console.warn('[costguard] Redis unavailable — using local fallback');
}
```

`isConnected()` is synchronous and reflects the last known connection state.

---

## 7. Shut down gracefully

Call `shutdown()` when your process exits to release the pooled Redis connection.

```ts
process.on('SIGTERM', async () => {
  await pro.shutdown();
  process.exit(0);
});
```

If multiple `GuardPro` instances share the same `redisUrl`, the underlying ioredis client is pooled. The connection closes only when the last instance calls `shutdown()`.

---

## 8. Redis key format

Spend keys are stored as:

```
costguard:spend:{projectId}
```

Example: `costguard:spend:tenant-abc`

You can inspect or manually reset keys using the Redis CLI:

```bash
redis-cli GET costguard:spend:tenant-abc
redis-cli DEL costguard:spend:tenant-abc
```

---

## 9. Local fallback behaviour

If Redis is unreachable at startup or during a request, `GuardPro` silently falls back to process-local spend tracking for that request. The fallback uses the same `windowSeconds` TTL. Budget enforcement continues — it is just not shared across processes until Redis reconnects.

This means:
- No crash or exception on Redis failure.
- Budget enforcement degrades gracefully to per-process isolation.
- Spend accumulated during fallback is not synced back to Redis.

---

## 10. Using a custom Redis client (testing)

Inject a `redisClient` to avoid a real Redis connection in tests:

```ts
import { GuardPro } from '@salimassili/ai-costguard/pro';

const mockRedis = {
  eval: async () => 0.005,
  get: async () => '0.005',
  del: async () => 1,
};

const pro = new GuardPro({
  redisUrl: '',
  budget: 10,
  redisClient: mockRedis,
});
```

The `GuardProRedisClient` interface requires only `eval`, `get`, and `del`. `connect`, `quit`, `on`, and `status` are optional.
