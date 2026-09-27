# Start Here

Orientation for people who opened the repository rather than just the npm page. If you only want to
use the library, [README.md](README.md) is the faster route; this file explains how the repository is
laid out and which document answers which question.

Everything here is MIT-licensed and free. There is no paid tier, no license key, no activation, and no
telemetry. If you find yourself looking for a way to unlock something, you have found a bug.

## Install

```bash
npm install @salimassili/ai-costguard
```

The package has **no runtime dependencies**. `ioredis` is optional and only needed for the
`@salimassili/ai-costguard/pro` shared-budget subpath.

## 60-second version

```ts
import OpenAI from 'openai';
import { guard } from '@salimassili/ai-costguard';

const client = guard(new OpenAI(), { budget: 5 });

await client.chat.completions.create({
  model: 'gpt-4o-mini',
  max_tokens: 500,
  messages: [{ role: 'user', content: 'Summarize this ticket.' }],
});
```

A request that would push the reservation past `$5` throws a `GuardError` **before** the provider is
called. See [README.md](README.md) for the full tour.

## Where things are

| Path | What it is |
| --- | --- |
| `src/` | All library source. The guard evaluator is `src/core/GuardCore.ts`. |
| `dist/esm/`, `dist/cjs/`, `dist/types/` | Build output. ESM, CommonJS, and `.d.ts`. Generated; never edit. |
| `test/` | `node:test` suites. `test/accounting.test.mjs` holds the concurrency and money tests. |
| `docs/` | Reference documentation. Start at the table below. |
| `examples/integrations/` | Runnable examples for OpenAI, Anthropic, LangChain, Mastra, CrewAI, Vercel AI, Slack, and CI. |
| `templates/` | Starter apps for Express and Next.js. |
| `benchmarks/` | Throughput and token-estimation accuracy measurements. |
| `scripts/` | Build, test, package, and release tooling. |
| `landing/` | The marketing site. Not part of the npm package. |

There is no other top-level directory. Four were removed in 2.3.0: three described a paid product that
no longer exists, and one duplicated `examples/integrations/quick-demo.mjs` while pinning a stale
published version. History lives in git, not in the working tree. `test/smoke-examples.mjs` allowlists
this directory list and fails if any of them reappear, so the authoritative list is asserted there rather
than restated in prose that could drift.

## Which document answers your question

| Question | Read |
| --- | --- |
| What does this cost, and can I trust the number? | [docs/ACCOUNTING.md](docs/ACCOUNTING.md) |
| Which of my calls are actually protected? | [docs/COVERAGE.md](docs/COVERAGE.md) |
| I run more than one process. Now what? | [docs/SHARED-BUDGET.md](docs/SHARED-BUDGET.md) |
| How do I wire this into my framework? | [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) |
| How do I see spend? | [docs/DASHBOARD.md](docs/DASHBOARD.md) |
| How fast is it? | [docs/BENCHMARKS.md](docs/BENCHMARKS.md) |
| How do I report a security issue? | [SECURITY.md](SECURITY.md) |
| How do I contribute? | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Why is it built this way? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| What changed? | [CHANGELOG.md](CHANGELOG.md) |

## Two things to know before you trust it

**1. Built-in pricing is a snapshot, not a live feed.** Nothing in this package fetches provider
pricing. The table is hand-maintained and dated, and the package warns you once at startup when it
is more than 30 days old. Verify the models you rely on against your provider's pricing page and
override them. Details in [docs/ACCOUNTING.md](docs/ACCOUNTING.md#built-in-pricing-is-a-snapshot-not-a-feed).

**2. The budget is enforced against a pre-call estimate, not a bill.** The guard reserves what a call
is expected to cost, and that reservation is what it blocks on. Provider-reported usage is recorded
for visibility but never refunds a reservation. Details in
[docs/ACCOUNTING.md](docs/ACCOUNTING.md#reservation-vs-actual-usage).

## Working on the library

```bash
npm install
npm run build       # dist/esm, dist/cjs, dist/types
npm test            # builds, then runs the suite with coverage
npm run typecheck   # tsc --noEmit across src, test, and examples
npm run smoke       # verifies examples, docs, and package metadata
```

Before opening a pull request, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Links

- npm: <https://www.npmjs.com/package/@salimassili/ai-costguard>
- GitHub: <https://github.com/salimassili62-afk/ai-costguard>
- Issues and questions: <https://github.com/salimassili62-afk/ai-costguard/issues>
