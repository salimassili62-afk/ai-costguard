# AI CostGuard Production Kit

Thank you for purchasing the AI CostGuard Production Kit. This package gives you the runtime guardrails you need to prevent runaway AI costs, repeated prompt loops, retry storms, and overspend before provider API calls are made. It includes production-ready templates, real-world integration examples, and setup guidance for local and shared-budget enforcement.

## What's Inside

- `express-costguard/` — production Express app with AI CostGuard pre-configured for a server-side AI workflow
- `nextjs-costguard/` — production Next.js app with AI CostGuard pre-configured for a web app integration
- `integrations/` — 10 real-world examples covering OpenAI, Anthropic, LangChain, Mastra, CrewAI, Vercel AI, Slack, and CI/CD usage
- `docs/` — dashboard guide, integrations guide, benchmarks, and Pro feature documentation
- `SETUP.md` — Redis and GuardPro setup guide for shared budgets across multiple servers

## Start Here

### Step 1: Install the free package

```bash
npm install @salimassili/ai-costguard
```

### Step 2: Pick your template and copy it into your project

Choose the app that fits your stack:

- `express-costguard/` for an Express backend
- `nextjs-costguard/` for a Next.js app

Copy the template into your project and adapt the environment and app logic to your service.

### Step 3: Copy your .env.example to .env and fill in your keys

Create a local environment file from the template, then add:

- your AI provider API key
- your Slack/Discord webhook URLs if you want alerts
- your Redis connection details if you are using GuardPro or shared budgets

### Step 4: Follow SETUP.md for Redis/GuardPro if you need shared budgets across multiple servers

If you are running multiple servers or want a shared budget checkpoint across workers, follow the setup instructions in `SETUP.md` before deploying.

### Step 5: Browse integrations/ for your framework

Use the examples in `integrations/` to match your stack:

- LangChain
- Vercel AI
- OpenAI
- Anthropic
- Mastra
- CrewAI
- Slack alerts
- CI/CD checks

## Key Links

- npm: https://www.npmjs.com/package/@salimassili/ai-costguard
- GitHub: https://github.com/salimassili62-afk/ai-costguard
- Support: open an issue on GitHub

---

Thank you for supporting an independent developer.
