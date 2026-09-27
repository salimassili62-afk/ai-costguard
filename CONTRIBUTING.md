# Contributing

## Setup

```bash
git clone <repository-url>
cd ai-costguard
npm ci
```

## Required Checks

Run these before opening a PR:

```bash
npm run build
npm test
npm run typecheck
npm run smoke
npm audit --omit=dev
npm pack --dry-run
```

`npm run package:test` additionally packs the tarball, installs it into a throwaway directory, and
exercises it as a real consumer through both `import` and `require`. Run it whenever you touch
`package.json#files`, the `exports` map, `bin`, or the build script. It needs network access for the
local `npm install`.

The project uses:

- TypeScript with `moduleResolution: NodeNext`
- Node's built-in `node:test` runner
- Dual ESM + CommonJS output (`dist/esm`, `dist/cjs`) with one shared declaration set

## Contribution Rules

- Keep documentation aligned with shipped behavior. `test/smoke-examples.mjs` asserts that every
  `docs/*.md` link in the README and in source comments resolves, so a dangling reference fails CI.
- Add tests for behavior changes. Concurrency and money changes need tests that exercise the real
  interleaving; see `test/accounting.test.mjs`.
- Do not add provider SDK dependencies to the root package. The free package ships zero runtime
  dependencies.
- Keep Redis functionality behind `@salimassili/ai-costguard/pro` so `ioredis` stays off the root
  import path. It is an optional peer dependency, not a bundled one.
- Do not claim proxy, dashboard, SaaS, auth, or telemetry features unless they are implemented and
  tested.
- Never date a test fixture to a literal when freshness is what the test depends on. Use
  `daysAgo()` from `test/helpers/dates.mjs`; the pricing staleness warning is calendar-dependent, and
  a pinned date produces a failure that has nothing to do with the change under test.
- Do not bump `BUILTIN_PRICING_LAST_UPDATED` unless the prices were actually re-verified against a
  provider pricing page. Claiming a date you did not check is worse than an honestly stale snapshot.

## Release Checklist

1. Update `CHANGELOG.md`.
2. Run the required checks, plus `npm run package:test`.
3. Inspect `npm pack --dry-run` output and confirm the file list.
4. Verify examples and templates reference the current package API.

## Repository Hygiene

Keep generated output and local release-test folders out of the public repository. The npm package is
controlled by `package.json#files`; it should include `dist`, the selected docs, the selected
integration examples, benchmarks, `README.md`, `CHANGELOG.md`, and `LICENSE`, but not the landing app
build output, `node_modules`, extracted ZIP tests, or local install-test projects.

`test/smoke-examples.mjs` enforces the parts of this that are easy to regress silently: it asserts
the removed directories stay removed, the `exports` map and both bins point at files that exist, the
root package has no runtime dependencies, and no document or example contains a purchase link, a
price, or a link to a document that no longer exists.
