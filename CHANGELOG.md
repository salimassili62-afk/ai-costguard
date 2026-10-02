# Changelog

## [2.3.2] - 2026-10-02

Release-hardening pass. No public API changes; the exported surface is unchanged from 2.3.1.

### Fixed

- **Webhook URL validation.** `alerts.webhookUrl` and the legacy `webhooks.slack` / `webhooks.discord` destinations are now validated before any request is sent. HTTPS is required for remote URLs; plain HTTP is accepted only for loopback hosts (`localhost`, `127.0.0.1`, `[::1]`). Malformed URLs are rejected. Validation fails safely: it can never throw into, delay, or alter a guard/block decision, and webhook delivery remains best-effort and observability-only. Slack/Discord payload shapes are unchanged.
- **Packaged README links.** `ARCHITECTURE.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `START-HERE.md` were linked from the shipped `README.md` but omitted from `package.json#files`, so the links resolved in the repository and 404'd in the published tarball. They are now shipped, and both the repository smoke test and the packed-package consumer test assert that every local link in `README.md` exists in the actual tarball.
- Corrected `docs/SHARED-BUDGET.md`, which documented `GuardError.metadata` as carrying `projectId`. The runtime field is `scopeKey`; the doc now lists the real `GuardErrorMetadata` fields.

### Changed

- Bumped the package to `2.3.2`.
- CI matrix now sets `fail-fast: false` so one Node version failing does not hide the status of the others.
- Refreshed the Express and Next.js starter templates to depend on `@salimassili/ai-costguard` `^2.3.2`.

### Added

- `test/webhooks-validation.test.mjs`: focused coverage for HTTPS remote acceptance, HTTP loopback acceptance (`localhost`, `127.0.0.1`, `[::1]`), HTTP remote rejection, malformed-URL rejection, crash-safety, and both the modern alerts and legacy webhooks entry points.
- `CODE_OF_CONDUCT.md`, bug/feature issue templates, and a pull request template.

## [2.3.0] - 2026-09-27

Correctness, concurrency, and honesty release. No API removals; the public surface is a superset of
2.2.x.

### Fixed

- **Money is now compared on the same scale it is stored on.** Budget decisions summed raw IEEE-754
  floats, so accumulated drift could reject a request that cost exactly the remaining budget: twenty
  `$0.05` requests summed to `0.9500000000000001` and the twentieth was blocked. All money is now
  rounded to micro-cent precision (1e-6 USD) at the point of addition, and the budget ceiling is
  inclusive. Covered by `TEST C` and a 40-way contention burst in `test/accounting.test.mjs`.
- **Reported `actualCost` now equals the value added to the running total.** Per-request reconciliation
  is rounded to the same scale, so `context.actualCost` and `state.actualCost` can no longer disagree
  by float noise.
- The build no longer fails on a missing `GuardEvent` type import in `GuardCore.ts`.
- **The token-accuracy benchmark corpus is no longer double-encoded.** The Arabic and French samples had
  been re-encoded as Latin-1, so they contained more characters than the real text. The estimator scored
  the Arabic sample at `116.67%` error while the intact string scores `0%`; the headline error figures in
  `docs/BENCHMARKS.md` were measured against the corrupted corpus. The corpus is restored and the figures
  are back to their verified values.
- Removed the `_archive/` directory. It was tracked, was missed by the hygiene sweep because the sweep only
  read a fixed directory list, and its README still advertised a `$199` Lemon Squeezy purchase.
- Removed the `costguard-demo/` directory: unreferenced, pinned to the published `2.2.3`, carrying
  `license: ISC` and an `npm test` script that always fails, and duplicating
  `examples/integrations/quick-demo.mjs` without ever running in CI.
- **A caller-supplied `scopeKey` can no longer reach `Object.prototype`.** Scope state was stored in a
  plain `{}` and read with an inherited-property lookup, so `context.scopeKey: '__proto__'` from the
  public `middleware()` export resolved to `Object.prototype` and wrote eleven accounting fields
  (`reservedCost`, `blockedCost`, `recentPrompts`, …) onto it globally, with a shared `recentPrompts`
  array inherited by every object in the process — while `Object.keys(state.scopes).length` stayed `0`,
  so `maxScopes` never counted it. Scope maps are now `Object.create(null)`, lookups are guarded with
  `Object.hasOwn`, and writes use `Object.defineProperty`, which makes `__proto__`, `constructor`,
  `toString`, and `valueOf` ordinary budgeted scopes that `maxScopes` actually counts. `Object.prototype`
  is left untouched. Regression tests in `test/accounting.test.mjs`.
- **A malformed event log can no longer kill the process.** `parseDashboardEvent` used truthiness
  checks, so a record with `"type": 42` passed validation and then reached `value.replaceAll` in the
  renderer; the resulting `TypeError` was thrown inside the `createServer` handler, i.e. an
  `uncaughtException` that took down the whole process — including the guarded application that
  started the dashboard. A directory passed as `--events` crashed every request the same way. Field
  types are now validated strictly, `escapeHtml` accepts `unknown`, and the handler returns HTTP 500
  on a read failure. Regression tests in `test/dashboard.test.mjs`.
- **The wrapper proxy no longer shadows nested `on`/`off`/`getGuardState`.** The `get` trap intercepted
  those three names at every depth, so `wrapped.nested.on()` returned the guard's subscription helper
  instead of the client's own `nested-on` method. Interception is now restricted to the root proxy.
- **`guardFunction()` works when a control name collides.** It read the target function off the root
  proxy, so guarding a function named `on`, `off`, or `getGuardState` returned the guard's helper and
  wrapped nothing. The function is now parked one level below the proxy, behind a generated control name.
- `recordActualUsage()` no longer throws when a scope has been dropped between `check()` and
  reconciliation. The path is not currently reachable, but the function is documented as
  "observability only, never fails a successful call" and now honors that.

### Changed

- **Event emission moved out of the budget critical section.** `emit('cost')` — which runs user event
  handlers and a blocking JSONL append — previously executed between the budget test and the
  reservation write. All side effects now happen after the reservation is committed, via a new
  internal `commitReservation()`. `check()` remains fully synchronous, so concurrent in-process
  callers still cannot both pass the budget test.
- **Built-in pricing staleness is disclosed at import time** rather than on the first `getPricing()`
  call, so the notice no longer lands on whichever lookup happens to be first.
- Removed a duplicate `gpt-4.1-mini` registry entry.
- Removed dead `src/core/CostGuard.ts`, a stale duplicate of `src/index.ts` with zero references.
- Removed the `pro-v0.1/` and `marketing/` directories, `aifw.example.js`, and `docs/PRO.md` /
  `docs/PRO_FEATURES.md`, all of which advertised a paid product that no longer exists.
- `ioredis` moved from `optionalDependencies` to an **optional peer dependency**, so a plain install
  stays dependency-free while the `/pro` requirement is still declared in the manifest.
- Test pricing dates are now computed relative to the run instead of pinned to literals; a hardcoded
  date silently broke unrelated warning assertions once the calendar crossed the 30-day threshold.
- **CLI `check` compares the rounded projection, not the raw float.** `0.1 * 3` is
  `0.30000000000000004`, so `check --budget 0.3` printed `estimatedCostUsd: 0.3` and still exited `1`
  ("over budget"). The projection is now rounded on the same micro-cent grid the accounting uses before
  the comparison, so a request that costs exactly the budget is allowed and the printed number matches
  the exit code.
- Missing and malformed CLI flags are now distinguished: a missing `--budget` says
  `--budget is required` instead of claiming it "must be a non-negative number, received undefined".
- The published tarball is materially smaller. Source maps and declaration maps are no longer emitted
  (every `.map` referenced a `src/*.ts` file that was never shipped, so they were dead weight pointing at
  nothing), and the redundant second set of hand-rolled `.d.ts` files is gone. Measured with
  `npm pack --dry-run --json`: 145 files / 741,728 bytes unpacked / 131,567 bytes packed → **70 files /
  440,397 unpacked / 99,434 packed** — 75 files and ~32 kB of packed size removed. `dist/types/*.d.ts`
  is still shipped and is what the `types` condition in the `exports` map resolves to, and
  `npm run typecheck` still type-checks consumers against the real `@types/node` signatures.
- Removed `src/node-shims.d.ts`. It was inert — `@types/node` is already a devDependency and typecheck
  passes without it — and while it was present it masked genuine Node signature mismatches, because a
  hand-written `declare module 'node:http'` stub satisfied a call that `@types/node` correctly rejects
  (`TS2769` on a bad `createServer` arity). Type safety is now real rather than declared.

### Added

- **Dual ESM + CommonJS build.** `dist/esm` and `dist/cjs`, with a self-describing `package.json` in
  each so the module system of a subtree never depends on the root `"type"`. `require()` now works.
- `UsageStatus` (`reported` | `partial` | `unavailable` | `skipped`) on `RequestContext`. A `usage`
  event is now emitted in every case, including when the provider reported nothing, so "no usage" is
  observable rather than silent.
- `DEFAULT_GUARDED_METHODS` is exported, so guard coverage can be asserted rather than trusted.
- `createGuardState()` is exported for callers that need several clients to share one reservation pool.
- `isBuiltInPricingStale()`, `listBuiltInPricing()`, and `PRICING_STALE_AFTER_DAYS` are exported.
- Unknown-model blocks now name the closest built-in sibling with its prices, making the fix obvious.
- **`PricingMatch` (`'exact' | 'family-prefix'`) on `PricingMeta`, and `pricingMatch` /
  `pricingModel` / `pricingOrigin` on the CLI `check` JSON output.** A name the registry has never seen
  — `gpt-4.1-turbo`, `o3-pro` — silently resolves to the longest `-`/`:`-prefixed built-in entry and is
  priced from it. `origin: 'builtin'` gave a caller no way to tell a real entry from that guess, so a
  budget gate could be enforcing an assumed price while reporting a confident-looking number. The match
  kind is now observable from both the API and the CLI. See
  [docs/ACCOUNTING.md](docs/ACCOUNTING.md#family-prefix-fallback-a-name-that-looks-unknown-is-often-priced-anyway).
- `docs/ACCOUNTING.md`, `docs/COVERAGE.md`, and `docs/SHARED-BUDGET.md`.
- `test/accounting.test.mjs`: 18 tests covering concurrent reservation, provider failure, usage
  reconciliation, retry storms, scope isolation, prototype-key safety, and coverage boundaries.
- `scripts/package-smoke.js` now installs the packed tarball and exercises both `import` and
  `require`, both bins, and the free-product integrity of the shipped artifact.
- `test/smoke-examples.mjs` now allowlists the repository's top-level directories, so a new folder of
  paid-kit material cannot slip past a sweep that only reads a hardcoded list.
- `test/smoke-examples.mjs` now rejects C1 control characters and double-encoded smart quotes in `docs/`,
  `examples/`, `benchmarks/`, `landing/`, and the root markdown. Double-encoded text changes the character
  count, which silently invalidates every benchmark computed from it.

### Deprecated

- `totalCost` is now documented as an alias of `reservedCost`. Use `reservedCost`.

### Documentation

Claims that did not survive a runtime check were corrected rather than re-worded:

- The `attemptedCost == reservedCost + blockedCost` invariant was claimed to hold "under every
  interleaving". It holds within `1e-12`, on a grid rounded to `1e-6`, and the claim is now stated that
  way in `README.md`, `ARCHITECTURE.md`, and `docs/ACCOUNTING.md`.
- "No call is ever allowed uncosted" was an overstatement: the guarantee is that no call is allowed
  *uncounted* — a pre-call estimate is always reserved, and a name the registry cannot price is blocked.
  A new **"Not guaranteed: priced exactly"** entry says so, and the `usage`-event claim (previously
  described as firing only when usage fields are available) now matches the code: it always fires, with
  a `UsageStatus` that says which case it is.
- `docs/ACCOUNTING.md` illustrated unknown-model blocking with a fabricated `claude-haiku-4.5` example
  and an unknown-model pricing example that does not occur. Both are replaced with messages captured
  from real runs, including the dot-vs-dash distinction that decides whether a name is blocked or
  family-prefix priced.
- `docs/COVERAGE.md` documented `guardFunction(client, 'run', config)`, a three-argument signature that
  does not exist, and omitted the control-name collision that caused the fix above. Both corrected.
- `docs/INTEGRATIONS.md` used `claude-haiku-4.5` in a runnable-looking example. Dated Anthropic model
  names use dashes; a dot makes the name unpriceable and the call is blocked.
- The `middleware()` trust boundary is now stated: `estimatedCost` and `scopeKey` come from the caller
  and are as trustworthy as the caller. (The `__proto__` fix above is a consequence of that.)
- `README.md` and `docs/DASHBOARD.md` now state the event log's operational cost: synchronous writes on
  the guarded call path, no rotation, and a full re-read and re-parse on every dashboard request.
- `benchmarks/token-accuracy.mjs` and `test/guard-core.test.mjs` referenced a non-existent
  `claude-sonnet-4.6`. Replaced with `claude-sonnet-4-5`; the change is behaviorally inert and the
  benchmark figures are unchanged.

### Notes

- Built-in pricing is still the `2026-08-23` snapshot. The date was deliberately **not** bumped,
  because the prices could not be re-verified. The snapshot is 35 days old, so the package warns once
  at import. This is a disclosure, not a regression.
- `check()` guarantees single-process atomicity only. Cross-process enforcement still requires a
  shared store; see `docs/SHARED-BUDGET.md`.
- Guard overhead is unchanged by this release. The previously published `0.023937 ms/call` figure sits
  inside the `0.021158`–`0.042931 ms/call` range measured over six consecutive runs of the new build
  (median `0.025101`), so the accounting work added no measurable cost. The figure is noisy because it
  is a difference of two wall-clock totals; `docs/BENCHMARKS.md` now says so and quotes a range. The
  `heapDeltaBytes` figure is not reproducible without `--expose-gc` — the same six runs spanned a `45x`
  range — so it is documented as noise rather than as a number.
- **Disclosure about the currently published 2.2.3.** The 2.2.3 tarball on npm contains
  `dist/license/validator.js`, a module that posts a license key to
  `https://api.lemonsqueezy.com/v1/licenses/validate` and caches the result in
  `~/.ai-costguard/license-cache.json`. It was reachable only through the `GuardPro` class; the free
  entry point never imported it, so free use was not gated. 2.3.0 deletes that module along with the rest
  of the paid-tier surface. Upgrading is what removes it — until 2.3.0 is published, the code is still
  in the tarball npm is serving.

## [2.2.3] - 2026-08-23

### Fixed
- Removed runtime license-key enforcement from `GuardPro`; the public Pro helper now works without a key.
- Added a 3-second timeout to remote license validation and strict seven-day cache expiry for legacy validation code.
- Added `CONFIG_INVALID` errors for unsafe GuardCore and GuardPro configuration values.
- Refreshed built-in pricing verification dates and added the canonical `docs/PRO.md` production guide. *(Superseded: `docs/PRO.md` was removed in 2.3.0. Its Redis, multi-tenant, and CI content is now in `docs/SHARED-BUDGET.md`.)*
- Added the package CLI to both starter templates' development dependencies.
- Aligned Pro pricing and checkout links across README, landing, marketing, and kit materials.

### Changed
- Exact registered tokenizers now have explicit coverage confirming they do not emit approximate-count warnings.
- Archived Pro starter materials now point to `docs/PRO.md` as the canonical guide. *(Superseded: see `docs/SHARED-BUDGET.md`.)*

### Notes
- This release note is the draft for the v2.2.3 GitHub release.
- The repository's public API remains compatible with 2.2.2.

## 2.2.0 - 2026-07-03

### Fixed

- Changed `GuardPro` budget enforcement so blocked over-budget charges are not persisted as real spend.
- Added `usage` event logging after provider usage reconciliation so local dashboard actual-spend summaries reflect provider-reported usage.

### Changed

- Aligned release-facing Pro copy around the then-current `$49` one-time production setup kit; the current offer is documented separately as the `$199` Production Kit.
- Updated starter template dependencies to `@salimassili/ai-costguard` `^2.2.0`.
- Recalibrated the built-in zero-dependency token estimator with simple model-family and text-shape heuristics.
- Improved the fixed proxy token benchmark from `237.76%` average error to `9.68%` average error while keeping `registerTokenizer()` as the recommended exact-counting path.
- Added release hygiene ignores and contribution notes for generated artifacts, local install-test projects, package output, and paid-kit archives.
- Renamed starter templates from `*-firewall` to `*-costguard`.
- Marked the older `pro-v0.1` folder as archived Redis-starter material.

## 2.1.0 - 2026-06-09

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
