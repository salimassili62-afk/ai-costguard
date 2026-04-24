# AI Execution Firewall

Stop AI agents from burning money in production.

## The Problem

AI agents in production systems can accidentally trigger runaway loops, duplicate requests, and context explosions that burn through API credits in seconds. Traditional monitoring only tells you after the money is gone.

## The Solution

AI Execution Firewall sits between your code and AI APIs, detecting and blocking dangerous request patterns before they execute. It's a safety layer that prevents cost waste in real-time.

## What It Detects

- **Runaway loops**: 5+ identical requests in 30 seconds (kill switch triggered)
- **Duplicate requests**: Same prompt sent repeatedly within 1 hour
- **Fuzzy duplicates**: Similar prompts (85%+ similarity) using Levenshtein distance
- **Context explosions**: Oversized payloads relative to prompt size
- **Cost spikes**: Single requests exceeding configured limits
- **Anomalies**: Behavioral deviation from normal usage patterns

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

1. **Request Interception**: Firewall intercepts AI API requests
2. **Pattern Analysis**: Analyzes request against detection rules
3. **Risk Scoring**: Calculates danger score (0-100) based on patterns
4. **Action Decision**: Blocks, warns, or allows based on trust mode
5. **Logging**: Records all requests with cost estimates for analytics

## Kill Switch

Critical patterns (runaway loops, extreme cost spikes) trigger the kill switch, instantly blocking requests regardless of trust mode. This prevents catastrophic cost spikes.

## Security

- **API Key Authentication**: Proxy supports optional API key via `x-firewall-api-key` header
- **Rate Limiting**: Configurable per-IP rate limiting (default: 60 requests/minute)
- **No Sensitive Data Logging**: Only prompt hashes (SHA-256) are stored, never raw prompts
- **Local Storage Only**: All data stored locally in `~/.ai-execution-firewall/`
- **No External Calls**: No telemetry or data sent to external servers

## Privacy

All data stored locally in `~/.ai-execution-firewall/`. No data sent to external servers.

## License

MIT
