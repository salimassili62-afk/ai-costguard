# AI CostGuard

The kill-switch for AI agents.

Prevent runaway AI agent loops, token bombs, and budget explosions before they happen.

```bash
npm install @salimassili/ai-costguard
```

## Install & Protect (30 seconds)

```ts
import { withCostGuard } from '@salimassili/ai-costguard';

const openai = withCostGuard(client, {
  maxTotalCostPerDay: 5
});
```

## What You Get

When your agent spirals:

```
[CostGuard] BLOCKED LOOP → 12 recursive cycles detected → estimated save: $18.42
```

A financial save event. Not a vague error.

## Why This Exists

AI agents don't fail gracefully. They fail exponentially.

A stuck agent can burn hundreds of dollars in API credits overnight. Not because it's fast. Because it's relentless.

Your agent framework has no kill-switch. Rate limiters don't detect semantic loops. Cost alerts tell you after the money is gone.

This is the missing layer.

## Real-World Protection

### 1. Recursive Loop
Agent repeats the same reasoning forever.

### 2. Tool Retry Explosion
Agent retries a failing tool endlessly.

### 3. Budget Breach
Agent burns tokens rapidly until blocked.

## API

```ts
withCostGuard(client, {
  maxTotalCostPerDay: 10,    // Hard USD limit
  maxTokensPerRequest: 4000, // Per-call limit
  maxRequestsPerMinute: 30,  // Rate limit
  loopDetection: true        // Catch repeated prompts
})
```

## Example

```ts
import { withCostGuard, CostGuardError } from '@salimassili/ai-costguard';

const openai = withCostGuard(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  { maxTotalCostPerDay: 5 }
);

try {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
  });
} catch (err) {
  if (err instanceof CostGuardError) {
    console.log('Agent blocked:', err.message);
    // Handle gracefully
  }
}
```

## Express Middleware

```ts
import { costGuardMiddleware } from '@salimassili/ai-costguard';

app.use(costGuardMiddleware({ maxTotalCostPerDay: 10 }));
```

## Features

- **Loop detection** — kills repeated prompts and recursive cycles
- **Daily cost caps** — hard USD limits, no overages
- **Token limits** — block oversized single requests
- **RPM limits** — catch agents hammering the API

## Install Before You Deploy

```bash
npm install @salimassili/ai-costguard
```

MIT | [GitHub](https://github.com/salimassili62-afk/ai-costguard)