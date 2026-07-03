# AI CostGuard Pro - Features

AI CostGuard Free is the open-source npm package (`@salimassili/ai-costguard`), MIT licensed, free forever.

**AI CostGuard Pro Self-Serve** is a $49 one-time production setup kit. The current production kit ships Redis/shared-budget setup material, Slack/webhook alert guidance, CI budget gates, deployment examples, and checklists that use the same public package API. Lemon Squeezy handles purchase, receipts, and downloads. The npm package does not perform runtime license-key enforcement. No private npm package. No SaaS backend.

## What Free Includes

| Capability | Free |
|---|---|
| `guard()` wrapper for OpenAI/Anthropic clients | Yes |
| `guardFunction()` for Vercel AI SDK and LangChain adapters | Yes |
| Pre-call cost estimation from built-in pricing registry | Yes |
| Budget enforcement per scope (process-local) | Yes |
| Loop detection with character trigram cosine similarity | Yes |
| Retry-storm detection | Yes |
| Structured `GuardError` codes | Yes |
| Event hooks: `block`, `allow`, `cost`, `usage` | Yes |
| Slack/webhook alerts, best-effort | Yes |
| Express middleware (`middleware()`) | Yes |
| CLI: `aifw check`, `ai-costguard check` | Yes |
| CLI: `aifw dashboard`, `ai-costguard dashboard` | Yes |
| Local JSONL event log | Yes |
| `registerTokenizer()` for custom token counting | Yes |
| `registerPricing()` for custom model pricing | Yes |
| `GuardPro` Redis helper through `/pro` subpath | Yes |
| MIT license, Node >= 18, zero cloud dependency | Yes |

## What Pro Adds

Pro is intended to deliver the setup guidance, annotated examples, and production checklists that teams typically build themselves when going from a working local guard to production-grade Node.js AI-agent deployments.

The current paid deliverable is the production kit. The older `pro-v0.1` folder is retained as archived Redis-starter material only; do not advertise it as the current paid kit.

| Deliverable | Status | What it covers |
|---|---|---|
| **Slack/webhook and threshold alert recipes** | Included in production kit | Environment-variable setup for local alerts without SaaS telemetry |
| **Redis/GuardPro setup guide** | Included in production kit | Step-by-step ioredis install, env-var config, connection pooling, and `GuardPro` initialization |
| **Multi-process shared budget example** | Included in production kit | Annotated TypeScript: two worker processes sharing one Redis-backed budget via `GuardPro` |
| **CI budget gate** | Included in production kit | Pipeline check for planned AI-agent spend |
| **Vercel AI example** | Included in production kit | Production adapter pattern for function-style AI calls |
| **Express production example** | Included in production kit | Middleware and error handling pattern for Node APIs |
| **Production deployment guide** | Included in production kit | Deployment checklist, env vars, Redis, and alert handling |
| **Multi-tenant isolation example** | Planned update | Express app with per-tenant `GuardPro` instances and per-request budget scoping |
| **`registerTokenizer()` adapter recipes** | Planned update | tiktoken and Anthropic tokenizer wrappers with error handling and fallback |
| **`GuardError` handling recipes** | Planned update | Per-code API response patterns for common block reasons |
| **Pricing override guide** | Planned update | How to register private/custom model pricing and validate entries |
| **Future kit updates** | Planned update | New examples, updated patterns, and notes delivered when complete |

## What Pro Is Not

- Not a SaaS platform or cloud dashboard
- Not a private npm package
- Not a license-key system
- Not a hosted analytics product
- Not a guarantee that provider billing matches estimates

Pro materials use only the public `@salimassili/ai-costguard` package. All examples use its published API surface.

Use environment variables or your deployment secret manager for provider API keys, `REDIS_URL`, webhook URLs, and any Lemon Squeezy account credentials. Do not hardcode secrets in application code or examples.

## Pricing

| Plan | Price | Includes |
|---|---|---|
| **Free** | $0 forever | Open-source npm package, MIT license |
| **Pro Self-Serve** | $49 one-time | Downloadable production setup kit |

No runtime license key is required; Lemon Squeezy handles the digital download.

[Get AI CostGuard Pro](https://salimassili.lemonsqueezy.com/buy/ai-costguard-pro)
