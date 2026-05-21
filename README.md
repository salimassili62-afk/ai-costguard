# AI CostGuard
[![npm version](https://img.shields.io/npm/v/@salimassili/ai-costguard)](https://www.npmjs.com/package/@salimassili/ai-costguard)

AI CostGuard is a small TypeScript library that wraps OpenAI-like clients and blocks requests before they run when local safety checks predict unsafe AI API spend.

It is ESM-only, targets Node.js 18+, and is built with `tsc`.

## What Works Today

- `guard()` wraps a client with budget, loop, and retry protection.
- `GuardError` is thrown when a request is blocked.
- Budget blocking estimates request cost before the API call.
- Loop detection blocks repeated prompts within the current process.
- Retry detection blocks repeated failure/retry prompts within the current process.
- `middleware()` adds the same local checks to web request flows.
- `getPricing()` returns known built-in model pricing.
- `registerPricing()` and `listPricing()` let you manage runtime pricing entries.

## Install

```bash
npm install @salimassili/ai-costguard
```

## Basic Usage

```ts
import OpenAI from 'openai';
import { guard, GuardError } from '@salimassili/ai-costguard';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ai = guard(client, { budget: 1 });

try {
  const response = await ai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Write a short project summary.' }],
    max_tokens: 200
  });

  console.log(response);
} catch (error) {
  if (error instanceof GuardError) {
    console.error('AI request blocked:', error.message, error.context);
  } else {
    throw error;
  }
}
```

## How `guard()` Works

`guard(client, config)` returns a `Proxy` around your client. When code calls a method such as `client.chat.completions.create(...)`, CostGuard:

1. Reads the request model, messages, and `max_tokens`.
2. Estimates input tokens from message length and combines them with the requested output limit.
3. Looks up pricing for the model.
4. Estimates the request cost.
5. Blocks the call with `GuardError` if the local budget would be exceeded.
6. Blocks repeated prompts that look like loops.
7. Blocks repeated prompts that look like retry storms.
8. Lets the original client method run when checks pass.

The free guard state is process-local. Separate Node.js processes do not share budget state.

## Budget Blocking

```ts
import { guard } from '@salimassili/ai-costguard';

const ai = guard(openai, { budget: 0.25 });

await ai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 100
});
```

When the estimated cumulative spend in the current process would exceed `budget`, CostGuard throws `GuardError` before calling the underlying AI client.

## Loop And Retry Detection

CostGuard keeps a short in-memory history of recent prompts for the wrapped client:

- Loop detection blocks repeated prompt hashes.
- Retry detection blocks repeated prompts containing retry/failure language such as `retry`, `again`, `repeat`, `error`, `fail`, or `timeout`.

These checks are intentionally local and lightweight.

## Middleware

```ts
import express from 'express';
import { middleware, GuardError } from '@salimassili/ai-costguard';

const app = express();

app.use(middleware({ budget: 2 }));

app.post('/chat', async (req, res, next) => {
  try {
    req.localSafety.check({
      model: 'gpt-4o-mini',
      tokens: 1000,
      estimatedCost: 0.001,
      timestamp: Date.now(),
      prompt: req.body?.prompt ?? ''
    });

    res.json({ ok: true });
  } catch (error) {
    if (error instanceof GuardError) {
      res.status(402).json({ error: error.message, context: error.context });
      return;
    }

    next(error);
  }
});
```

## Pricing

```ts
import { getPricing, listPricing, registerPricing } from '@salimassili/ai-costguard';

console.log(getPricing('gpt-4o-mini'));

registerPricing([
  {
    model: 'custom-model',
    inputPer1kTokens: 0.001,
    outputPer1kTokens: 0.002,
    lastUpdated: '2026-05-21',
    source: 'internal'
  }
]);

console.log(listPricing());
```

`getPricing(model)` returns an exact match when available, then falls back to simple fuzzy matching. Unknown models return `undefined`.

## Pro Features (Coming Soon)

> These features are under active development and not yet available:
> - Distributed Redis-backed budget state
> - Real Slack/Discord webhook alerts
> - Multi-instance coordination
> - Production license validation

## API

### `guard(client, config)`

Wraps an OpenAI-like client.

```ts
guard(client, { budget: 10 });
```

### `GuardError`

Thrown when CostGuard blocks a request.

```ts
try {
  await ai.chat.completions.create(params);
} catch (error) {
  if (error instanceof GuardError) {
    console.log(error.context);
  }
}
```

### `middleware(config)`

Creates request middleware with local budget, loop, and retry checks.

### `getPricing(model, overrides?)`

Returns pricing for a model from overrides, runtime registrations, or built-in entries.

### `registerPricing(entries)`

Registers or replaces runtime pricing entries by model name.

### `listPricing()`

Returns built-in and runtime pricing entries, deduplicated by model name.

## Limitations

- Free guard state is stored in memory only.
- Budget checks are estimates, not billing records.
- Token estimation is approximate.
- Pricing entries are static until the package or runtime registry is updated.
- The library does not include dashboards, analytics, governance workflows, or hosted services.

## License

MIT
