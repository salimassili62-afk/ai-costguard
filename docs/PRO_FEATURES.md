# AI CostGuard Pro — Features

AI CostGuard Free is the open-source npm package (`@salimassili/ai-costguard`), MIT licensed, free forever.

**AI CostGuard Pro** is a $19/month or $199/year subscription. The current v0.1 download ships Redis-focused setup material and an annotated shared-budget example that use the same public package API. Lemon Squeezy handles purchase, receipts, and subscription management. The npm package does not perform runtime license-key enforcement. No private npm package. No SaaS backend.

---

## What Free includes

| Capability | Free |
|---|---|
| `guard()` wrapper for OpenAI/Anthropic clients | ✓ |
| `guardFunction()` for Vercel AI SDK and LangChain adapters | ✓ |
| Pre-call cost estimation from built-in pricing registry | ✓ |
| Budget enforcement per scope (process-local) | ✓ |
| Loop detection (character trigram cosine similarity) | ✓ |
| Retry-storm detection | ✓ |
| Structured `GuardError` codes | ✓ |
| Event hooks: `block`, `allow`, `cost` | ✓ |
| Slack and Discord block webhooks (best-effort) | ✓ |
| Express middleware (`middleware()`) | ✓ |
| CLI: `aifw check`, `ai-costguard check` | ✓ |
| CLI: `aifw dashboard`, `ai-costguard dashboard` | ✓ |
| Local JSONL event log | ✓ |
| `registerTokenizer()` for custom token counting | ✓ |
| `registerPricing()` for custom model pricing | ✓ |
| `GuardPro` Redis helper (via `/pro` subpath) | ✓ |
| MIT license, Node ≥ 18, zero cloud dependency | ✓ |

---

## What Pro adds

Pro is intended to deliver the setup guidance, annotated examples, and production checklists that teams typically build themselves when going from a working local guard to a production-grade deployment.

The current `pro-v0.1` folder in this repository is a Redis-focused starter. Do not advertise a paid ZIP as containing a deliverable until that file is actually present in the downloadable folder.

| Deliverable | Status | What it covers |
|---|---|---|
| **Redis/GuardPro setup guide** | Included in `pro-v0.1` | Step-by-step ioredis install, env-var config, connection pooling, and `GuardPro` initialization |
| **Multi-process shared budget example** | Included in `pro-v0.1` | Annotated TypeScript: two worker processes sharing one Redis-backed budget via `GuardPro` |
| **Multi-tenant isolation example** | Planned update | Express app with per-tenant `GuardPro` instances and per-request budget scoping |
| **`registerTokenizer()` adapter recipes** | Planned update | tiktoken (OpenAI) and Anthropic tokenizer wrappers with error handling and fallback |
| **`GuardError` handling recipes** | Planned update | Per-code API response patterns for `BUDGET_EXCEEDED`, `LOOP_DETECTED`, `RETRY_STORM_DETECTED`, `UNKNOWN_MODEL`, `MAX_STEPS_EXCEEDED` |
| **Pricing override guide** | Planned update | How to register private/custom model pricing, validate entries, and use `getPricingMeta()` for CI freshness checks |
| **Production-readiness checklist** | Planned update | Budget sizing, scope design, tokenizer registration, pricing staleness, webhook config, event log setup, Redis fallback handling |
| **Express config starter** | Planned update | `costguard.config.js` with recommended middleware defaults, error handler, and scope extraction pattern |
| **Next.js config starter** | Planned update | `costguard.config.js` for API routes with GuardPro Redis integration and `GuardError` response shaping |
| **Monthly implementation updates** | Subscription benefit | New examples, updated patterns, and notes on pricing registry changes delivered to subscribers |

---

## What Pro is not

- Not a SaaS platform or cloud dashboard
- Not a private npm package
- Not a license-key system
- Not a hosted analytics product
- Not a guarantee that provider billing matches estimates

Pro materials use only the public `@salimassili/ai-costguard` package. All examples use its published API surface.

Use environment variables or your deployment secret manager for provider API keys, `REDIS_URL`, webhook URLs, and any Lemon Squeezy account credentials. Do not hardcode secrets in application code or examples.

---

## Pricing

| Plan | Price | Includes |
|---|---|---|
| **Free** | $0 forever | Open-source npm package, MIT license |
| **Pro** | $19/month or $199/year | Downloadable setup folder + monthly updates |

Cancel anytime from your Lemon Squeezy customer portal.

[Get AI CostGuard Pro →](https://salimassili.lemonsqueezy.com/buy/ai-costguard-pro)
