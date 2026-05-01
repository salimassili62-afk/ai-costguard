# AI Execution Firewall

Pre-execution spend protection for AI agents.

AI Execution Firewall blocks runaway loops, token bombs, duplicate agent calls, and tenant budget breaches before the model provider charges you. Use Helicone, Langfuse, LiteLLM, or Portkey for visibility and routing; use AIFW when you need a hard cost kill switch in front of production agents.

## Why It Exists

Production agents can burn real money before dashboards catch up:

- Runaway loops: repeated identical prompts in seconds
- Token bombs: huge context or output requests
- Agent storms: burst traffic from recursive tools
- Customer quota breaches: one tenant or workflow consuming shared budget
- Silent duplication: same prompt retried without useful change

AIFW sits before execution and returns `allow`, `warn`, or `block` with a danger score, request ID, policy ID, estimated savings, and decision explanation.

## Install

```bash
npm install ai-execution-firewall
```

```bash
npx ai-execution-firewall init
```

## Five-Minute OpenAI Setup

```ts
import OpenAI from 'openai';
import { withFirewall } from 'ai-execution-firewall';

const openai = withFirewall(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
  trustMode: 'block',
  metadata: {
    orgId: 'acme',
    appId: 'support-agent',
  },
  onBlock: (reason, score, estimatedCost) => {
    console.error('AI request blocked', { reason, score, estimatedCost });
  },
});

const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Draft a short reply' }],
  metadata: {
    userId: 'user_123',
    sessionId: 'session_456',
    agentId: 'support-bot',
    workflowId: 'ticket-reply',
  },
});
```

The wrapper also intercepts `responses.create`, embeddings, image generation, audio calls, and common nested SDK paths.

## Generic Fetch Setup

```ts
import { withFetchFirewall } from 'ai-execution-firewall';

const safeFetch = withFetchFirewall(fetch, {
  trustMode: 'block',
  metadata: { orgId: 'acme', appId: 'worker' },
});

await safeFetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hello' }],
  }),
});
```

## Express Middleware

```ts
import express from 'express';
import { expressFirewall } from 'ai-execution-firewall';

const app = express();
app.use(express.json());

app.use(expressFirewall({
  trustMode: 'block',
  metadata: req => ({
    orgId: req.header('x-tenant-id'),
    userId: req.header('x-user-id'),
    agentId: req.header('x-agent-id'),
  }),
}));
```

## Proxy Mode

```bash
npx ai-execution-firewall start --port 3000
```

Point OpenAI-compatible SDKs at:

```txt
http://localhost:3000/v1
```

Supported proxy paths include OpenAI-style `/v1/chat/completions`, Anthropic `/v1/messages`, and Google Gemini `/v1beta/*`. The proxy exposes:

- `GET /health`
- `GET /metrics` for Prometheus-style metrics

## Configuration

`aifw.config.json` supports old flat keys and the new production sections.

```json
{
  "trustMode": "block",
  "privacy": {
    "promptStorage": "hash",
    "retentionDays": 30,
    "redactPatterns": [
      "(sk-[A-Za-z0-9_-]{20,})",
      "([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})"
    ]
  },
  "storage": {
    "adapter": "jsonl"
  },
  "budgets": {
    "perRequestUsd": 1,
    "dailyUsd": 50,
    "monthlyUsd": 1000
  },
  "policies": [
    {
      "id": "enterprise-tenant",
      "scope": { "orgId": "acme" },
      "budgets": {
        "perRequestUsd": 0.5,
        "dailyUsd": 25,
        "monthlyUsd": 500,
        "workflowUsd": 10,
        "tokensPerRequest": 20000
      }
    }
  ],
  "alerts": {
    "enabled": false,
    "channels": [
      {
        "type": "webhook",
        "url": "https://example.com/aifw-alerts",
        "minRiskLevel": "HIGH"
      }
    ]
  }
}
```

## Privacy Defaults

AIFW stores prompt hashes by default, not plaintext prompts.

| Mode | Stored prompt field | Use case |
| --- | --- | --- |
| `hash` | `[hash:<sha256>]` | Production default |
| `redacted` | Prompt with configured patterns removed | Debugging with privacy controls |
| `plaintext` | Full prompt text | Local development only |

All data is local by default under `~/.aifw/`. No telemetry is sent by the package.

## Public APIs

```ts
import {
  checkRequest,
  explainDecision,
  getBudgetStatus,
  recordActualUsage,
  registerPricingModel,
  createStorageAdapter,
} from 'ai-execution-firewall';
```

- `checkRequest(model, prompt, estimatedCost, metadata)` returns preflight allow/block status.
- `getBudgetStatus(metadata)` returns scoped daily, monthly, and workflow spend.
- `explainDecision(result)` returns a human-readable decision explanation.
- `recordActualUsage(ledgerId, response, model)` reconciles actual provider usage.
- `registerPricingModel(model, pricing)` adds custom or OpenRouter model aliases.
- `createStorageAdapter(config)` creates `memory` or `jsonl` adapters. `sqlite` and `postgres` are reserved production adapter names for external builds.

## Pricing Registry

The pricing registry supports OpenAI, Anthropic, Google, custom models, aliases, cached input tokens, reasoning tokens, audio tokens, and image units.

```ts
import { registerPricingModel } from 'ai-execution-firewall';

registerPricingModel('acme-agent-model', {
  provider: 'custom',
  inputPrice: 0.002,
  outputPrice: 0.004,
  cachedInputPrice: 0.001,
  aliases: ['openrouter/acme-agent-model'],
});
```

## Detection Rules

| Pattern | Default threshold | Result |
| --- | --- | --- |
| Runaway loop | 3 identical requests in 30 seconds | Kill switch block |
| Duplicate prompt | Same prompt within 1 hour | Warn or block |
| Fuzzy duplicate | 70%+ similarity | Warn or block |
| Context explosion | Context 5x larger than prompt | Warn or block |
| Cost spike | $0.05+ estimated request cost | Warn or block |
| Budget breach | Scoped per-request, daily, monthly, workflow, or token budget | Block |

Trust modes:

- `monitor`: log decisions, allow non-kill-switch requests
- `warn`: warn on risk, allow non-kill-switch requests
- `block`: block dangerous requests

Kill switch decisions always block.

## CLI

```bash
aifw demo
aifw check "your prompt" --model gpt-4o-mini
aifw start --port 3000
aifw dashboard
aifw budget --set 50
aifw report
aifw blocked
```

## B2B Positioning

AIFW is intentionally not a full observability platform. It is the enforcement layer you can put beside existing gateways and dashboards:

```txt
App or agent -> AIFW policy decision -> provider gateway/SDK -> model provider
```

The goal is simple: if an agent starts losing money, AIFW stops the spend before execution.

## License

MIT
