# AI Cost Protection Layer for Production Systems

**Prevent AI agents from silently burning $100–$1000 in minutes.**

> 🚨 **This is not optional. This is infrastructure that prevents financial loss.**

## The $10,000 Problem

AI agents in production can trigger runaway loops, infinite recursion, and cost spikes that drain your API budget before you notice:

- **Runaway loops**: 3+ identical requests in 30 seconds → $200+ per hour
- **Token bombs**: Single request asking for 100k tokens → $30+ per call
- **Agent storms**: 150+ requests/minute → $600+ per hour
- **Silent duplication**: Same prompt repeated → 10x unnecessary cost

**Traditional monitoring only tells you after the money is gone.**

## The Solution: AI Execution Firewall

A cost protection layer that **blocks dangerous requests BEFORE execution** — not after you've already paid.

### 💰 Financial Impact

| Scenario | Without Firewall | With Firewall | **Saved** |
|----------|-----------------|---------------|-----------|
| Runaway loop (1 hour) | $245 burned | $0 blocked | **$245** |
| Token bomb (1 request) | $30 charged | $0 blocked | **$30** |
| Cost spike (1 hour) | $620 spent | $0 blocked | **$620** |
| Daily protection | Variable | Capped at $50 | **$$$** |

## What It Detects & Blocks

| Pattern | Threshold | Action |
|---------|-----------|--------|
| **Runaway loops** | 3+ identical requests in 30 seconds | Kill switch (block, danger score 93+) |
| **Duplicate requests** | Same prompt within 1 hour | Warn/block (danger score 40-90) |
| **Fuzzy duplicates** | 70%+ similarity (Levenshtein) | Warn/block (danger score 30-70) |
| **Context explosions** | Context 5x+ larger than prompt | Warn/block (danger score 25-75) |
| **Cost spikes** | $0.05+ per request | Warn/block (danger score 30-100) |

Kill switch activates at danger score ≥90, blocking regardless of trust mode.

## 🆕 Infrastructure Upgrades (v1.0.5)

### 1. Real Cost Truth (Not Estimation)
- Extracts actual token usage from API responses
- Maps tokens to real pricing (OpenAI, Anthropic, Google, Cohere)
- Tracks: `actualCost`, `estimatedCost`, `saved`, `wouldHaveLost`
- Rule: `saved = wouldHaveLost - actualSpent`

### 2. Strict Default Enforcement
- Default mode: **BLOCK** (non-optional)
- CI fails by default on HIGH risk
- Proxy blocks automatically without config
- `--strict` flag for enforcement

### 3. Impact-Driven Output
```
🔥 YOU ALMOST LOST $245.00
🛡️ BLOCKED BEFORE EXECUTION

DETAILS:
COST: $0.00
WOULD HAVE LOST: $245.00
SAVED: $245.00
RISK: CRITICAL
DECISION: BLOCK
```

### 4. Session-Level Aggregation
```bash
aifw summary
```
```
💸 WITHOUT FIREWALL:
   You would have spent $125.50

🛡️ WITH FIREWALL:
   You spent $12.30
   Saved $113.20
```

## Installation

```bash
npm install -g ai-execution-firewall
```

**Auto-setup on install:**
- Detects project type (Next.js, Express, Node.js)
- Creates `aifw.config.json`
- Generates integration example
- Adds npm scripts

## Quick Start

### Initialize Project

```bash
npx ai-execution-firewall init
```

Creates:
- `aifw.config.json` - Configuration
- `aifw.example.js` - Integration example
- `.github/workflows/aifw.yml` - CI/CD workflow

### See It In Action (Demo)

```bash
aifw demo
```

**Output shows real money saved:**
```
📊 SCENARIO 1: Agent Loop Detection
⚠️  LOOP DETECTED (47 repeated requests)
🔥 RISK LEVEL: CRITICAL
💰 ESTIMATED COST PREVENTED: $4.23
🚨 IF NOT BLOCKED: ~$245/day potential loss
✅ ACTION: BLOCKED - Loop broken, credits saved
```

### Option 1: SDK Middleware (Recommended)

**Zero code changes. Drop-in protection.**

```typescript
import { withFirewall } from 'ai-execution-firewall';
import OpenAI from 'openai';

// Wrap your client — ALL calls now protected
const openai = withFirewall(new OpenAI({ apiKey: '...' }), {
  trustMode: 'block',  // 'monitor' | 'warn' | 'block'

  // Real-time alerts
  onBlock: (reason, dangerScore, estimatedCost) => {
    console.log(`🔥 BLOCKED: ${reason}`);
    console.log(`💰 SAVED: $${estimatedCost}`);
  },
  onWarn: (reason, dangerScore, estimatedCost) => {
    console.log(`⚠️  WARNING: ${reason}`);
  },
  onSpike: (requests, timeWindow) => {
    console.log(`🚨 SPIKE: ${requests} requests in ${timeWindow}s`);
  }
});

// Use normally — firewall intercepts automatically
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }]
});

// Also intercepts:
await openai.responses.create({...});
await openai.chat.completions.create({...});  // Any nested call
```

### Option 2: Express Middleware

```typescript
import express from 'express';
import { expressFirewall } from 'ai-execution-firewall';

const app = express();

// Global protection for all AI endpoints
app.use(expressFirewall({
  trustMode: 'block',
  onBlock: (req, res, reason) => {
    res.status(403).json({
      error: 'Blocked by AI Cost Protection',
      reason,
      saved: '$$$'
    });
  }
}));

app.post('/v1/chat/completions', handleChat);
```

### Option 3: Proxy Mode

```bash
# Start the firewall proxy
aifw start --port 3000

# Configure your AI SDK to use the proxy
baseURL: 'http://localhost:3000/v1'
```

### Option 4: CLI Check

```bash
# Check if a request is safe before sending
aifw check "your prompt here" --model gpt-4

# View cost protection dashboard
aifw dashboard

# Set daily budget limit
aifw budget --set 50.00
```

## Configuration

```bash
# Set trust mode (default: warn)
aifw config --trust-mode warn    # monitor, warn, or block

# Set maximum cost per request
aifw config --max-cost 2.0

# Set danger threshold
aifw config --danger-threshold 60
```

**Trust Modes:**
- `monitor`: Log everything, allow all requests
- `warn`: Log warnings, allow requests (default)
- `block`: Block dangerous requests

## Commands

```bash
aifw demo                 # See cost protection scenarios in action
aifw check <prompt>       # Check if a request is safe
aifw start                # Start the firewall proxy
aifw dashboard            # View real-time cost protection dashboard
aifw budget               # Configure daily spending limits
aifw report               # View protection statistics
aifw config               # Configure firewall settings
aifw blocked              # View blocked requests log
```

## Supported Models

**OpenAI:**
- gpt-4, gpt-4-32k, gpt-4-turbo, gpt-4-turbo-preview, gpt-4o, gpt-4o-mini, gpt-3.5-turbo, gpt-3.5-turbo-16k

**Anthropic:**
- claude-3-opus-20240229, claude-3-sonnet-20240229, claude-3-haiku-20240307
- claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022
- claude-2.1, claude-2, claude-instant-1.2

## How It Works

1. **Request Interception**: Firewall intercepts AI API requests via Proxy or SDK wrapper
2. **Pattern Analysis**: DetectionEngine analyzes against 5 rule types (loop, duplicate, cost, context, fuzzy)
3. **Risk Scoring**: Calculates danger score (0-100) based on thresholds:
   - Loop: 90 + (count-2)×3, capped at 100
   - Duplicate: 40 + count×10, capped at 90
   - Cost: 30 + (cost-0.05)×50, capped at 100
   - Context: 25 + ln(ratio)×15, capped at 75
   - Fuzzy: 30 + similarity×40, capped at 70
4. **Action Decision**: 
   - `monitor`: Allow all, log only
   - `warn`: Allow dangerous (<90), log warning
   - `block`: Block dangerous (≥50), allow safe
   - Kill switch: Always block (≥90)
5. **Logging**: Records to `~/.aifw/history.jsonl` with full prompt text (plaintext)

## Kill Switch

Activates at danger score ≥90. Always blocks regardless of trust mode.

**Triggers:**
- Runaway loops: 3+ identical requests in 30s (starts at 93, escalates to 100)
- Cost spikes: $1.25+ per request (reaches 90 at $1.25)

**Response format (HTTP 403):**
```json
{
  "error": "🔴 KILL SWITCH: RUNAWAY LOOP - 3 identical requests in 30 seconds. 💸 Prevented: $0.XX",
  "blocked": true,
  "dangerScore": 93,
  "killSwitchTriggered": true,
  "suggestions": ["Use a cheaper model", "Reduce token count", "Split into smaller requests"]
}
```

## Security

- **API Key Authentication**: Proxy validates `x-firewall-api-key` header against configured key
- **Rate Limiting**: Per-IP limiting (default: 60 req/min). Returns HTTP 429 with `Retry-After: 60`
- **Data Storage**: Prompts stored in plaintext in `~/.aifw/history.jsonl` (SHA-256 hash also recorded for deduplication)
- **Local Only**: All data in `~/.aifw/` directory, no external calls
- **No Telemetry**: No data sent to external servers

## Privacy

All data stored locally in `~/.aifw/`:
- `history.jsonl` - Request history (prompts, costs, danger scores)
- `logs.jsonl` - Detailed request logs
- `config.json` - User configuration

No data sent to external servers. No telemetry collected.

## License

MIT
