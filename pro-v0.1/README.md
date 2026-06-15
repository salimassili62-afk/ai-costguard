# AI CostGuard Pro v0.1

Thank you for subscribing to AI CostGuard Pro ($19/month or $199/year).

This folder is your Pro v0.1 download. It is a Redis-focused starter that uses the public `@salimassili/ai-costguard` npm package. Do not advertise additional Pro examples or checklists as included until those files are present in the downloadable folder.

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
- Not runtime license-key enforcement or DRM. Lemon Squeezy handles subscription management and receipts.
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
