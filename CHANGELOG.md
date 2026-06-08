# Changelog

## 2.1.0 - Unreleased

### Added

- Added `registerTokenizer()` for exact/provider-specific token counting without adding production dependencies.
- Added `getPricingMeta()` and `aifw pricing --check-stale --days <n>` for pricing freshness checks.
- Added structured `loopDetection` config with `similarityThreshold`, `minHistorySize`, and `windowSize`.
- Expanded the token accuracy benchmark to a 24-sample proxy corpus with per-sample output.

### Changed

- Removed obsolete license-related surfaces. AI CostGuard does not contain license-key checks or local commercial-license enforcement.
- Added explicit built-in pricing freshness notice: `2026-06-07`.
- Updated README loop detection tuning, pricing freshness, token accuracy, and trust guidance.
- Documented that the built-in estimator materially overestimates the fixed proxy corpus and that production users can register exact tokenizers.

## 2.0.0 - 2026-06-08

### Changed

- Moved Redis-backed `GuardPro` exports to `@salimassili/ai-costguard/pro` so the root import stays lightweight.
- Removed fake local license enforcement from `GuardPro`.
- Unknown models now block by default unless runtime pricing, guard pricing overrides, or explicit fallback pricing is configured.
- Guard proxy now checks known AI SDK method paths instead of charging every function call on the wrapped client.
- Loop detection now requires repeated similar prompts in the same scope before blocking.
- Retry detection now requires stronger retry/failure signals to reduce false positives.
- Prompt and retry histories are scoped and TTL-bound.

### Added

- `guardFunction()` for Vercel AI SDK, LangChain, Mastra-style, CrewAI launcher, and other function-style integrations.
- Local JSONL event logging and `ai-costguard dashboard` / `aifw dashboard` for local-only visibility.
- Mocked runnable integration examples for OpenAI, Anthropic, Vercel AI SDK, LangChain, Mastra, CrewAI, and CI checks.
- Local benchmark script and benchmark documentation.
- Structured `GuardError.code` and `GuardError.metadata`.
- Scoped accounting fields for attempted, allowed, blocked, and reconciled actual cost.
- CLI custom pricing flags for private/custom models.
- `/pricing` package subpath export.
- Repository smoke checks for examples, templates, package exports, and stale claims.

### Removed

- Active root docs and templates for unimplemented proxy/dashboard/SaaS features.
- Unused postinstall helper, stale ESLint config, and stale npm ignore file.

## 1.2.0 - 2026-05-28

### Changed

- Rebuilt the package around a strict ESM TypeScript core.
- Replaced the old character-count token heuristic with an inline BPE-style estimator.
- Replaced exact prompt matching with character trigram cosine similarity loop detection at the default `0.85` threshold.
- Reworked `GuardPro` with pooled Redis connections, TTL-based spend windows, and local fallback when Redis is unavailable.
- Rewrote the README to describe only shipped behavior.

### Added

- `guard.on('block' | 'allow' | 'cost', callback)` event hooks.
- Optional Slack and Discord block webhooks with exponential backoff and silent failure.
- `aifw check --budget --model --tokens --max-steps` CLI for CI budget checks.
- Stale pricing warnings for entries older than 30 days.
- Node-native unit and integration tests for GuardCore, GuardFree, GuardPro, middleware, pricing, token estimation, webhooks, and CLI behavior.

### Removed

- Removed stale Jest configuration and CommonJS-era test setup.
- Removed README claims about dashboards, hosted monitoring, and proxy features that are not shipped in this package.
