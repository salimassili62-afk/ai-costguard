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
npm run smoke
npm audit --omit=dev
npm pack --dry-run
```

The project uses:

- TypeScript with `moduleResolution: NodeNext`
- Node's built-in `node:test` runner
- ESM-only package output

## Contribution Rules

- Keep documentation aligned with shipped behavior.
- Add tests for behavior changes.
- Do not add provider SDK dependencies to the root package.
- Keep Redis/Pro functionality behind `@salimassili/ai-costguard/pro`.
- Do not claim proxy, dashboard, SaaS, auth, or telemetry features unless they are implemented and tested.

## Release Checklist

1. Update `CHANGELOG.md`.
2. Run the required checks.
3. Inspect `npm pack --dry-run` output.
4. Verify examples/templates reference the current package API.

## Repository Hygiene

Keep generated output and local release-test folders out of the public repository. The npm package is controlled by `package.json#files`; it should include `dist`, selected docs, selected integration examples, benchmarks, `README.md`, `CHANGELOG.md`, and `LICENSE`, but not the landing app build output, `node_modules`, extracted ZIP tests, local install-test projects, or downloadable paid-kit archives.
