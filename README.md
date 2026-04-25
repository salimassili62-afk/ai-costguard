# AI Execution Firewall

Stop AI agents from burning money in production.

## The Problem

AI agents in production systems can accidentally trigger runaway loops, duplicate requests, and context explosions that burn through API credits in seconds. Traditional monitoring only tells you after the money is gone.

## The Solution

AI Execution Firewall sits between your code and AI APIs, detecting and blocking dangerous request patterns before they execute. It's a safety layer that prevents cost waste in real-time.

## What It Detects

| Pattern | Threshold | Action |
|---------|-----------|--------|
| **Runaway loops** | 3+ identical requests in 30 seconds | Kill switch (block, danger score 93+) |
| **Duplicate requests** | Same prompt within 1 hour | Warn/block (danger score 40-90) |
| **Fuzzy duplicates** | 70%+ similarity (Levenshtein) | Warn/block (danger score 30-70) |
| **Context explosions** | Context 5x+ larger than prompt | Warn/block (danger score 25-75) |
| **Cost spikes** | $0.05+ per request | Warn/block (danger score 30-100) |

Kill switch activates at danger score ≥90, blocking regardless of trust mode.

## Installation

```bash
npm install -g ai-execution-firewall
```

## Quick Start

### Option 1: Proxy Mode (Recommended)

```bash
# Start the firewall proxy
aifw start --port 3000

# Configure your AI SDK to use the proxy
# OpenAI example:
baseURL: 'http://localhost:3000/v1'

# Anthropic example:
baseURL: 'http://localhost:3000'
```

### Option 2: SDK Mode

```typescript
import { AIExecutionFirewall } from 'ai-execution-firewall';

const firewall = new AIExecutionFirewall();

// Wrap your AI API calls
const result = await firewall.call(
  async () => await openai.chat.completions.create({...}),
  { model: 'gpt-4', messages: [...] }
);

if (result.blocked) {
  console.log('Blocked:', result.reason);
  console.log('Money saved:', result.savedAmount);
}
```

### Option 3: CLI Check

```bash
# Check if a request is safe before sending
aifw check "your prompt here" --model gpt-4
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
aifw check <prompt>      # Check if a request is safe
aifw start                # Start the firewall proxy
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
