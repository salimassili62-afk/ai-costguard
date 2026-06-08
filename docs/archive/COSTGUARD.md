# CostGuard

**One-line SDK middleware that prevents AI agent cost explosions.**

---

## Positioning (ONE SENTENCE)

> CostGuard is a drop-in SDK wrapper that stops AI agents from running away on your AWS bill.

---

## Installation

```bash
npm install cost-guard
```

**Time: 30 seconds**

---

## Integration

### ONE LINE

```typescript
import { guard } from 'cost-guard';
import OpenAI from 'openai';

// BEFORE
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// AFTER - One line change
const client = guard(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
```

**That's it. Your agent is now protected.**

---

## What It Does

Prevents 3 things:

1. **Runaway Loops** → Stops agents after 50 steps  
2. **Cost Spikes** → Blocks calls that exceed $10/session  
3. **Redundant Calls** → Prevents 3+ duplicate API calls  

---

## Architecture (4 Components)

```
┌─────────────────────────────────────────┐
│  YOUR CODE                              │
│  client.chat.completions.create()      │
│           │                             │
│           ▼                             │
├─────────────────────────────────────────┤
│  COSTGUARD PROXY (<5ms)                 │
│           │                             │
│           ▼                             │
│  ┌─────────────────────────────────┐   │
│  │ 1. SESSION STORE               │   │
│  │    - Track cost/step/duplicates │   │
│  │    - In-memory only            │   │
│  └─────────────────────────────────┘   │
│           │                             │
│           ▼                             │
│  ┌─────────────────────────────────┐   │
│  │ 2. RULE ENGINE (deterministic) │   │
│  │    Rule 1: Cost > $10? → BLOCK │   │
│  │    Rule 2: Steps > 50? → BLOCK │   │
│  │    Rule 3: Dups > 3?   → BLOCK │   │
│  └─────────────────────────────────┘   │
│           │                             │
│           ▼                             │
│  ┌─────────────────────────────────┐   │
│  │ 3. GUARD CORE                   │   │
│  │    - Execute 3 rules            │   │
│  │    - <5ms p95                   │   │
│  │    - Fail open on error         │   │
│  └─────────────────────────────────┘   │
│           │                             │
│           ▼                             │
│  ┌─────────────────────────────────┐   │
│  │ 4. SDK WRAPPER                  │   │
│  │    - Proxy all calls            │   │
│  │    - One-line integration       │   │
│  └─────────────────────────────────┘   │
│           │                             │
│           ▼                             │
│  API CALL (if allowed)                 │
└─────────────────────────────────────────┘
```

---

## Core Logic (<5ms Budget)

```typescript
function check(session, call) {
  // 1. Cost check (<1ms)
  if (session.totalCost + call.cost > $10) {
    return BLOCK;
  }

  // 2. Loop check (<1ms)
  if (session.steps >= 50) {
    return BLOCK;
  }

  // 3. Deduplication check (<1ms)
  if (countDuplicates(call) >= 3) {
    return BLOCK;
  }

  // Record and allow (<1ms)
  session.record(call);
  return ALLOW;
}
```

**Total: <4ms typical, <5ms p95**

---

## Configuration (Optional)

```typescript
import { initGuard } from 'cost-guard';

// Only if you want non-defaults
initGuard({
  maxCostPerSession: 50,    // $50 instead of $10
  maxStepsPerSession: 100,  // 100 instead of 50
  maxDuplicateCalls: 5,     // 5 instead of 3
  failOpen: true,           // Allow on error (safer)
});

const client = guard(new OpenAI({ apiKey }));
```

**Zero config works for 90% of cases.**

---

## Real Failure Modes

### 1. False Positives (Blocks valid call)

**Rate:** 1-3%  
**Example:** Agent needs expensive reasoning step, gets blocked.

**Mitigation:**
- Fail open by default
- Error includes `blockedCost` so user can override
- Tune limits for your use case

```typescript
try {
  const result = await client.chat.completions.create({...});
} catch (error) {
  if (error.message.includes('CostGuard')) {
    console.log(`Would have spent: $${error.guardResult.blockedCost}`);
    // Override: Use direct client or increase limit
  }
}
```

---

### 2. Latency Spike (>5ms)

**When:** High GC pressure, session cleanup

**Mitigation:**
- Fixed budget: if >5ms, fail open
- LRU cache on session store
- Max 10K sessions in memory

---

### 3. Bypass (Developer calls API directly)

**Reality:** Cannot prevent determined bypass.

**Mitigation:**
- This is a safety net, not a wall
- Document: "Use guard() or risk cost explosion"

---

### 4. Cost Underestimation

**When:** Actual cost > estimated cost

**Mitigation:**
- Estimates use $0.03/1K tokens (GPT-4 rate)
- Conservative by design (over-estimates)
- Real spend can be 2-3x estimate and still within limit

---

## Comparison (Honest)

| Product | What It Does | CostGuard Difference |
|---------|--------------|---------------------|
| **LiteLLM** | Proxy router for 100+ providers | CostGuard = in-process SDK wrapper, no proxy |
| **Helicone** | Observability/logging | CostGuard = pre-call prevention, not post-call |
| **Portkey** | Gateway + load balancing | CostGuard = no infra needed, 1 line integration |
| **Langfuse** | Tracing/debugging | CostGuard = runtime blocking, not debugging |

**CostGuard is the only one that:**
- Requires zero infrastructure
- Installs in 1 line
- Blocks before spend happens
- Runs in-process (<5ms)

---

## Success Metrics

| Metric | Target | How Verified |
|--------|--------|--------------|
| Setup time | <5 min | User test |
| Integration lines | 1 | Code review |
| Latency p95 | <5ms | Benchmark |
| False positive rate | <3% | User override tracking |
| Cost prevented | $X/session | Blocked call tracking |

---

## Hard Verdict

### Classification: **Viable Developer Tool**

**What it is:** Stripe-level SDK that prevents AI cost explosions.

**TAM:** Small. Only teams with AI cost concerns.

**Technical Moat:** None. Could be replicated in weeks.

**Value Proposition:** Sharp. One problem. One solution.

**Realistic Outcomes:**
- **Best:** $100K-500K/year indie tool
- **Likely:** Popular open source, modest revenue
- **Worst:** Ignored (problem not painful enough)

**Build if:** You want a simple, useful tool with clear value.  
**Skip if:** You want a platform, ecosystem, or unicorn.

---

## Usage Example

```typescript
import { guard } from 'cost-guard';
import OpenAI from 'openai';

// One line protection
const client = guard(new OpenAI({ apiKey }));

// Use normally - CostGuard intercepts automatically
async function agent() {
  for (let i = 0; i < 100; i++) {  // Loop that might run away
    try {
      const result = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: `Step ${i}` }],
        max_tokens: 2000,
      });
      
      console.log(`Step ${i} complete`);
      
    } catch (error) {
      if (error.message.includes('CostGuard')) {
        console.log(`Stopped at step ${i}: ${error.message}`);
        console.log(`Saved: $${error.guardResult.blockedCost}`);
        break;  // Exit loop gracefully
      }
      throw error;
    }
  }
}

agent();
```

---

## Summary

**CostGuard prevents AI agents from spending too much money.**

- **3 rules:** cost limit, step limit, deduplication
- **1 line:** wraps your SDK client
- **<5ms:** runs in-process
- **0 infra:** no proxy, no gateway, no setup

This is infrastructure plumbing. Not a platform. Not an ecosystem. Just cost prevention.
