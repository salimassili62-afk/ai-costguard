# AI CostGuard Pro v0.1 Archive

This folder is archived Redis-starter material. The current paid deliverable is the AI CostGuard Pro production kit, sold as a $49 one-time digital download.

This folder uses the public `@salimassili/ai-costguard` npm package. Keep it only for historical reference; do not advertise `pro-v0.1` as the current paid kit.

## What Is Included

```text
pro-v0.1/
|-- README.md
|-- SETUP.md
|-- CHANGELOG.md
`-- examples/
    `-- redis-shared-budget.ts
```

## Prerequisites

Install the free public package first:

```bash
npm install @salimassili/ai-costguard
```

For Redis examples, also install `ioredis`:

```bash
npm install ioredis
```

Node.js >= 18 is required.

## What This Is Not

- Not a private npm package. All examples import from `@salimassili/ai-costguard`.
- Not runtime license-key enforcement or DRM. Lemon Squeezy handles purchase management and receipts.
- Not a SaaS backend or cloud dashboard.
- Not a billing ledger or provider invoice reconciler.
- Not a guarantee that estimates match provider invoices.

## Getting Started

1. Read `SETUP.md` if you need Redis/GuardPro shared budgets.
2. Review `examples/redis-shared-budget.ts`.
3. Copy the pattern into your project and configure secrets through environment variables or your deployment secret manager.

## Monthly Updates

Updated versions of this folder are delivered to your Lemon Squeezy customer portal as the package evolves. You will receive an email notification when a new version is available.

## Questions

Open an issue on GitHub: https://github.com/salimassili62-afk/ai-costguard

Or reply to your Lemon Squeezy confirmation email.
