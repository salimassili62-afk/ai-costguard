# AI Execution Control Layer (AECL)

**Production-Grade Design Document**  
**Not a platform story. Real engineering.**

---

## A. Architecture Diagram (Real Execution Flow)

```
┌─────────────────────────────────────────────────────────────┐
│                     AGENT APPLICATION                        │
│                                                              │
│  openai.chat.completions.create({...})                      │
│         │                                                    │
│         ▼                                                    │
├─────────────────────────────────────────────────────────────┤
│              AECL INTERCEPTION POINT (<5ms)                 │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. CACHE CHECK (sub-ms)                           │   │
│  │     • Hash lookup: sessionId+step+op+cost           │   │
│  │     • Cache hit → return cached decision           │   │
│  └─────────────────────────────────────────────────────┘   │
│         │ (cache miss)                                      │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  2. RISK SCORING (<1ms)                              │   │
│  │     • Cost explosion: velocity check                  │   │
│  │     • Loop detection: A-B-A-B pattern match          │   │
│  │     • Redundancy: hash dedup check                   │   │
│  │     • Output: 0-1 risk score                        │   │
│  └─────────────────────────────────────────────────────┘   │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  3. POLICY EVALUATION (<1ms)                         │   │
│  │     • Session cost > $10? → BLOCK                   │   │
│  │     • Steps > 50? → BLOCK                           │   │
│  │     • Request cost > $5? → BLOCK                  │   │
│  │     • Risk > 0.85? → BLOCK                          │   │
│  │     • Default → ALLOW                               │   │
│  └─────────────────────────────────────────────────────┘   │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  4. DECISION & CACHE (<1ms)                          │   │
│  │     • Cache decision for 60s                         │   │
│  │     • Return: allow/block + reason + savings        │   │
│  └─────────────────────────────────────────────────────┘   │
│         │                                                    │
│         ▼ (async, non-blocking)                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  5. TELEMETRY (background)                           │   │
│  │     • Log decision to memory                         │   │
│  │     • Update ROI metrics                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  IF ALLOWED:                                                 │
│     → Call OpenAI/Anthropic API                              │
│     → Record actual cost (async)                             │
│                                                              │
│  IF BLOCKED:                                                 │
│     → Return error with explanation                          │
│     → Log estimated savings                                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## B. Core API Design

### `intercept(request: ExecutionRequest): DecisionResult`

**ExecutionRequest:**
```typescript
{
  id: string;                    // Unique request ID
  provider: 'openai' | 'anthropic' | 'langchain' | 'custom';
  operation: string;             // e.g., "chat.completions.create"
  model?: string;
  estimatedTokens: number;      // Predicted token count
  estimatedCost: number;       // USD (e.g., 0.06 for $0.06)
  context: {
    sessionId: string;          // Groups related calls
    agentId: string;           // Identifies the agent
    stepNumber: number;        // Current step in workflow
    previousCalls: number;     // Calls in this session
    totalTokens: number;      // Accumulated tokens
    totalCost: number;        // Accumulated cost (USD)
    startTime: number;        // Session start timestamp
  };
  inputHash: string;          // SHA256 of input (for dedup)
}
```

**DecisionResult:**
```typescript
{
  decision: 'allow' | 'block';
  reason: string;              // Human-readable explanation
  riskScore: number;          // 0-1 composite score
  confidence: number;          // 0-1 confidence in decision
  latencyMs: number;          // Actual decision time
  policyTriggered?: string;   // Which rule fired
  estimatedSavings?: number;   // If blocked: $ saved
  cacheHit: boolean;          // Whether cache was used
}
```

### `score(context: RiskContext): RiskAssessment`

Calculates numeric risk score (0-1) with explainable factors.

**RiskAssessment:**
```typescript
{
  score: number;              // 0-1 composite
  factors: {
    costExplosion: number;     // Probability of cost runaway
    infiniteLoop: number;      // Probability of infinite loop
    redundancy: number;        // Probability of redundant call
    composite: number;         // Weighted combination
  };
  explanation: string[];       // Human-readable reasons
  confidence: number;          // 0-1 based on data quality
}
```

### `evaluate_policy(context: PolicyContext): PolicyResult`

Evaluates simple rules. No complex hierarchy.

**Default Policy Rules:**
| Rule | Condition | Threshold | Action |
|------|-----------|-----------|--------|
| session_cost_limit | cost | > $10 | block |
| step_limit | depth | >= 50 | block |
| request_cost_limit | cost | > $5 | block |
| repetition_limit | repetition | >= 3 | block |
| risk_threshold | risk | > 0.85 | block |

### `log_execution(trace: ExecutionTrace)`

Records hashed trace for deduplication detection.

**Stores ONLY:**
- Hashed input (SHA256)
- Hashed output (SHA256)
- Cost and token metrics
- Timestamps
- Operation type

**Does NOT store:**
- Raw prompts
- Raw responses
- PII

---

## C. Realistic Failure Modes

### 1. False Positives

**Scenario:** AECL blocks a legitimate expensive operation.

**Impact:** User frustration, workflow interruption.

**Mitigation:**
- Fail-open default (configurable)
- One-click override with cost acknowledgment
- False positive tracking in telemetry
- Adjustable thresholds per use case

**Rate Target:** <2% false positive rate

---

### 2. Latency Overhead

**Scenario:** AECL decision takes >5ms p95.

**Impact:** Slows down agent execution, user-visible delay.

**Mitigation:**
- LRU cache for repeat decisions
- Fixed budget timeout (fail-open after 5ms)
- No I/O in hot path
- In-memory only, no network calls

**Target:** <2ms avg, <5ms p95

---

### 3. Bypass Risks

**Scenario:** Developer calls API directly, bypassing AECL.

**Impact:** Cost explosions not prevented.

**Mitigation:**
- SDK wrapper that intercepts at library level
- Warning logs when direct calls detected
- Not a security boundary - safety feature only

**Reality:** Cannot prevent determined bypass. This is a safety net, not a security gate.

---

### 4. Integration Friction

**Scenario:** Setup takes >10 minutes.

**Impact:** Low adoption.

**Mitigation:**
- Single import: `import { aecl } from 'aecl'`
- Zero-config defaults
- Drop-in SDK wrapper
- No API keys for basic use

---

### 5. Memory Growth

**Scenario:** Long-running sessions cause unbounded memory growth.

**Mitigation:**
- TTL eviction (1 hour default)
- Max sessions cap (10,000 default)
- Max traces per session (100 default)
- Automatic cleanup every minute

---

## D. Competitive Analysis (Honest)

### LiteLLM
**What it does:** Universal proxy for 100+ LLM providers  
**Technical reality:** Router + caching + cost tracking  

**AECL difference:**
- LiteLLM = proxy (requires infrastructure change)
- AECL = library (in-process, no proxy needed)
- AECL focuses on *pre-call* risk detection, not just routing

**LiteLLM advantage:** Multi-provider support, caching, production-grade  
**AECL advantage:** Lower latency, simpler integration, risk scoring

---

### Helicone
**What it does:** Observability platform for LLM calls  
**Technical reality:** Logging + analytics + cost tracking  

**AECL difference:**
- Helicone = post-call observability
- AECL = pre-call interception
- AECL blocks bad calls *before* they happen

**Helicone advantage:** Deep analytics, dashboards, request inspection  
**AECL advantage:** Prevention (not just monitoring), <5ms overhead

---

### Portkey
**What it does:** Gateway for AI apps  
**Technical reality:** Load balancing + guardrails + analytics  

**AECL difference:**
- Portkey = gateway (hosted or self-hosted)
- AECL = in-process library
- AECL has no infrastructure dependency

**Portkey advantage:** Gateway pattern, enterprise features, scale  
**AECL advantage:** Zero infrastructure, deterministic latency, simpler

---

### Langfuse
**What it does:** LLM engineering platform  
**Technical reality:** Tracing + evaluation + prompt management  

**AECL difference:**
- Langfuse = observability + prompt engineering
- AECL = runtime risk prevention
- Different use cases, can be complementary

---

### Honest Verdict
AECL fills a gap: **deterministic, low-latency, pre-call risk detection** without infrastructure overhead. It does NOT replace proxies, observability platforms, or gateways. It complements them with fast in-process decision-making.

---

## E. MVP Build Plan (30 Days)

### Week 1: Minimal Interceptor
**Goal:** Working intercept() with <5ms latency

**Tasks:**
- [ ] Core interception class
- [ ] LRU cache implementation
- [ ] Basic policy evaluation (cost limits only)
- [ ] Latency benchmarking
- [ ] Fail-open error handling

**Deliverable:** `aecl.intercept()` works with default policy

---

### Week 2: Risk Scoring
**Goal:** Deterministic 0-1 risk scores

**Tasks:**
- [ ] Cost explosion detection (velocity-based)
- [ ] Loop pattern detection (A-B-A-B matching)
- [ ] Redundancy detection (hash dedup)
- [ ] Composite score calculation
- [ ] Explainability (human-readable reasons)

**Deliverable:** `aecl.assessRisk()` returns explainable scores

---

### Week 3: Telemetry + ROI
**Goal:** Show measurable cost savings in 7 days

**Tasks:**
- [ ] Decision logging
- [ ] Cost tracking (estimated vs actual)
- [ ] False positive tracking
- [ ] 7-day ROI calculation
- [ ] CSV export for billing
- [ ] Dashboard summary endpoint

**Deliverable:** Customer can see "You saved $X this week"

---

### Week 4: Production Pilots
**Goal:** 3 production deployments

**Tasks:**
- [ ] OpenAI SDK wrapper
- [ ] Anthropic SDK wrapper
- [ ] LangChain integration example
- [ ] Documentation + quickstart
- [ ] Performance benchmarking
- [ ] Customer feedback integration

**Deliverable:** 3 paying customers in production

---

## F. Hard Truth Verdict

### Classification: **Viable Niche SaaS**

**Why NOT a commodity:**
- Deterministic <5ms latency is technically non-trivial
- Pre-call risk scoring with explainability has limited open-source alternatives
- Focus on "cost explosion prevention" is a specific, measurable value

**Why NOT a strong infra company candidate:**
- Limited TAM (only orgs with AI cost concerns)
- Feature, not platform (complements existing tools)
- No network effects or data moat
- Easily replicated by LiteLLM/Portkey if they prioritize it

**What it IS:**
A **specialized tool** for teams running AI agents who need deterministic cost control with minimal overhead.

**Realistic Outcomes:**
- **Best case:** $1-5M ARR niche product, acquired by LiteLLM/Portkey
- **Likely case:** $100-500K ARR, sustains as indie product
- **Worst case:** Open source project, used but not monetized

**Technical moat:** Not strong. Latency optimization is replicable.  
**Value moat:** Focus and simplicity. Big platforms have broader concerns.

**Recommended path:**
1. Open source core library (adoption)
2. Hosted dashboard + analytics (revenue)
3. Enterprise support (revenue)
4. Be realistic about ceiling: $1-5M ARR max

---

## Performance Benchmarks (Targets)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Decision latency (avg) | <2ms | `performance.now()` |
| Decision latency (p95) | <5ms | 95th percentile |
| Cache hit rate | >30% | telemetry |
| False positive rate | <2% | user override tracking |
| Setup time | <10 min | user testing |
| Memory per session | <100KB | heap profiling |
| ROI visibility | <7 days | customer reporting |

---

## Conclusion

AECL is a **real, buildable, sellable product** for a specific problem: preventing AI cost explosions with minimal latency and setup friction.

It is NOT a platform, NOT an OS, and NOT a $1B company.  
It IS a focused tool that delivers measurable ROI for a specific customer segment.

**Build it if:** You want a viable SaaS in the AI infrastructure space.  
**Don't build it if:** You want a unicorn or category-defining company.
