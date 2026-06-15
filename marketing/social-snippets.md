# AI CostGuard — Launch Social Snippets

> Copy-paste ready. Replace `[YOUR_LS_URL]` with your Lemon Squeezy checkout link before posting.
> Lemon Squeezy URL placeholder: `https://salimassili.lemonsqueezy.com/buy/ai-costguard-pro`

---

## Twitter / X — Launch Thread

**Tweet 1 (hook)**

```
I built a local-first runtime safety layer for AI agents.

It wraps your OpenAI/Anthropic client, estimates cost before every call, and blocks budget overruns, loops, and retry storms — entirely in process.

No cloud. No SaaS. No proxy.

→ @salimassili/ai-costguard on npm
```

---

**Tweet 2 (the problem)**

```
AI agents fail in a specific way in production:

- One retry loop runs 200 API calls
- A prompt bug creates a cost spike overnight
- A dev session with no budget cap hits $40 before anyone notices

None of this is caught before the call executes.
```

---

**Tweet 3 (the solution)**

```
AI CostGuard adds one wrapper:

  const openai = guard(new OpenAI(...), {
    budget: 5,
    maxSteps: 50,
    scope: { sessionId: agentRunId },
  });

That's it. GuardError is thrown before the provider is reached.

npm install @salimassili/ai-costguard
```

---

**Tweet 4 (what it guards)**

```
What it blocks before the API call executes:

✓ BUDGET_EXCEEDED — estimated cost > remaining budget
✓ LOOP_DETECTED — repeated similar prompts in the same scope
✓ RETRY_STORM_DETECTED — runaway retry/failure signals
✓ MAX_STEPS_EXCEEDED — too many guarded calls in one run
✓ UNKNOWN_MODEL — no pricing → no call
```

---

**Tweet 5 (what it is not)**

```
Important: AI CostGuard is not a SaaS, proxy, or billing reconciler.

It's a pre-call estimator. Estimates can diverge from provider invoices.

Docs are honest about this. The README has a whole "What it is not" section.

Real guardrails, no fake claims.
```

---

**Tweet 6 (Pro CTA)**

```
Just launched AI CostGuard Pro — $19/month or $199/year.

What Pro includes:
• Redis/GuardPro setup guide
• Multi-process shared budget example
• Environment-variable based Redis/webhook config
• Monthly updates as new production materials are completed

No private npm. Lemon Squeezy manages the subscription; the package has no runtime license-key enforcement. Uses the same public package.

[Get Pro →] https://salimassili.lemonsqueezy.com/buy/ai-costguard-pro
```

---

## Hacker News — Show HN Post

**Title**

```
Show HN: AI CostGuard – local-first runtime safety for AI agents (npm)
```

**Body**

```
I built a small Node.js npm package that wraps OpenAI/Anthropic SDK clients (and function-style adapters like Vercel AI SDK) and evaluates every request before it reaches the provider.

What it does:
- Estimates cost from the local pricing registry before the call executes
- Blocks unknown models, budget overruns, agent loops, and retry storms
- Throws structured GuardError with machine-readable codes
- Emits local events, writes a JSONL event log, and runs a local-only dashboard
- Includes CLI budget checks for CI pipelines
- Optional Redis-backed shared budgets via /pro subpath

What it is not:
- Not a SaaS, cloud proxy, or hosted analytics product
- Not a billing reconciler — estimates can diverge from provider invoices
- Not a security boundary

The README has explicit "What it does" and "What it does not" sections because I wanted to be honest about the scope.

npm: https://www.npmjs.com/package/@salimassili/ai-costguard
GitHub: https://github.com/salimassili62-afk/ai-costguard

I also launched a $19/month or $199/year Pro plan. v0.1 includes a Redis/GuardPro setup guide and a multi-process shared-budget example, with monthly production materials planned as they are completed. No private npm; Lemon Squeezy manages the subscription and it uses the same public package.

Happy to answer questions about the design, especially the loop detection (character trigram cosine similarity) and the token estimation approach (dependency-free approximation with registerTokenizer() for exact counting).
```

---

## LinkedIn — Launch Post

```
I just published AI CostGuard — a local-first runtime safety layer for AI agents.

The problem: AI agents fail in a specific way in production. One retry loop, one budget-unaware dev session, one prompt bug running overnight — and you're looking at a provider invoice that was entirely preventable.

AI CostGuard wraps your SDK client and blocks requests before they execute:
→ Estimates cost from a local pricing registry
→ Blocks budget overruns, agent loops, and retry storms
→ Throws structured GuardError with machine-readable codes
→ Runs entirely in your process — no cloud, no SaaS, no proxy

One line to add the wrapper:

  const openai = guard(new OpenAI({ apiKey }), {
    budget: 5,
    maxSteps: 50,
    scope: { projectId: 'my-app' },
  });

Works with OpenAI, Anthropic, Vercel AI SDK, LangChain adapters, and any function-style SDK call.

Free on npm (MIT): @salimassili/ai-costguard
Pro ($19/month or $199/year): Redis setup guide, shared-budget example, and monthly production-material updates.

Link in comments.

#ai #nodejs #typescript #llm #agentops #opensource
```

---

## Reddit — r/node or r/MachineLearning Post

**Title**

```
I built a local npm package that blocks AI agent runaway costs before API calls execute [Show and Tell]
```

**Body**

```
Hey r/node,

I published AI CostGuard — a small Node.js package that wraps your OpenAI or Anthropic client and evaluates every API call before it executes.

**What problem it solves**

AI agents accumulate cost in unpredictable ways: loops, retries, misconfigured max_tokens, or just a dev session left running overnight. AI CostGuard stops those before they reach the provider.

**How it works**

```js
const openai = guard(new OpenAI({ apiKey }), {
  budget: 5,
  maxSteps: 50,
  scope: { projectId: 'my-app', sessionId: agentRunId },
});

// GuardError thrown before provider if budget/loop/retry limit hit
await openai.chat.completions.create(request);
```

**What it checks**
- Pre-call cost estimation from a local pricing registry
- Budget enforcement per scope (project/user/session)
- Loop detection using character trigram cosine similarity
- Retry-storm detection
- Unknown model blocking

**What it is NOT**
- Not a SaaS or cloud proxy
- Not a billing reconciler (estimates ≠ provider invoices)
- Not a security boundary

The README is honest about all of these limitations.

**Links**
- npm: `npm install @salimassili/ai-costguard`
- GitHub: https://github.com/salimassili62-afk/ai-costguard

Happy to answer questions on the token estimation approach, loop detection tuning, or the Redis/GuardPro shared budget helper.
```
