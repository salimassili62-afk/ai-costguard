# OpenAI Agent Cost Explosion Prevention Layer

Stop OpenAI agent cost explosions before they happen.

A pre-execution firewall that detects and blocks runaway AI agent patterns—saving 60-90% on production API costs.

## The 3 Problems We Solve

1. **Runaway agent loops** → Infinite recursive calls draining budget
2. **Uncontrolled API spending** → No visibility into per-request costs
3. **Production LLM cost spikes** → Sudden $10K+ surprises at month-end

## Try It (No Install Required)

```bash
# Run interactive demo
npx ai-firewall demo

# Or try the web demo
open https://ai-firewall.io/demo
```

See live simulations of cost explosions—and how much you save by blocking them.

## Integration Example

```ts
import OpenAI from 'openai';
import { initFirewall, withFirewall } from 'ai-firewall';

const firewall = initFirewall({ apiKey: process.env.FIREWALL_API_KEY! });
const openai = withFirewall(new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

const decision = firewall.evaluate({
  model: 'gpt-4o-mini',
  prompt: 'Summarize these tickets',
  maxOutputTokens: 240,
});

if (decision.decision !== 'block') {
  await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Summarize these tickets' }],
  });
}
```

## Enterprise Trust Features

**Audit & Compliance:**
- Every decision logged with cryptographic integrity
- Hash-chained audit trail (tamper-evident)
- Replay any execution for debugging
- Compliance certificates for audits

**Production Safety:**
- Circuit breaker on engine failures
- Always returns a decision (never crashes execution)
- Automatic fallback to safe defaults
- Sub-100ms decision latency guaranteed

**Deterministic Replay:**
```ts
import { replaySession, generateComplianceReport } from 'ai-firewall';

// Replay any past decision
const result = replaySession('session-123');
console.log(result.summary); // "All 50 decisions replayed identically"

// Generate compliance certificate
const report = generateComplianceReport('session-123');
console.log(report.certificate); // Tamper-evident proof
```

## Distribution & Sharing

**Shareable Demo Links:**
```ts
import { quickDemo, generateViralPayload } from 'ai-firewall';

// Create shareable demo
const { session, link } = quickDemo('Runaway Chatbot');
console.log(link.url); // https://ai-firewall.io/demo/abc123

// Generate tweet-ready content
const payload = generateViralPayload(session);
console.log(payload.tweet); // Copy-paste ready
```

**Hosted Demo Server:**
```bash
# Start self-serve demo server
npx ai-firewall demo-server

# Users can now try without installing:
# → http://localhost:3001/demo
```

## What This Is NOT

❌ General AI safety platform  
❌ Model evaluation framework  
❌ Generic "AI guardrails" tool  
❌ Multi-cloud abstraction layer  

✅ **Only OpenAI cost explosion prevention**  
✅ **Only production API spending control**  
✅ **Only runaway agent detection**

---

**One-sentence pitch:** *We stop AI agents from wasting money in production.*
