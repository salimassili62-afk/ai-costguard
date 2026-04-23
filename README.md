# AI Waste Guard

A developer tool that sits between your code and AI APIs (OpenAI, Claude) to **prevent wasted API usage before it happens** — not just track it.

## 🎯 Core Value

Detect and **BLOCK inefficient / redundant / expensive AI requests** in real-time, and show you exactly how much money you saved.

## ✨ Features

- **Request Interception** - Intercept all outgoing AI API calls (OpenAI, Claude)
- **Token + Cost Estimation** - Estimate tokens and cost before sending requests
- **Waste Detection Engine** - Detect repeated prompts, large redundant context, infinite loops
- **Prevention System** - Block or warn based on configurable waste thresholds
- **Suggestions Engine** - Get actionable fixes for wasteful patterns
- **Local Logging** - Track total cost, prevented cost, and blocked requests
- **CLI Interface** - Simple command-line tool for management

## 📋 Requirements

- Node.js 18+ 
- npm or yarn

## 🚀 Installation

```bash
# Clone the repository
cd ai-waste-guard

# Install dependencies
npm install

# Build the project
npm run build
```

## 💻 Usage

### Option A: SDK Wrapper (Recommended for direct integration)

```typescript
import { AIWasteGuard } from 'ai-waste-guard';
import OpenAI from 'openai';

const guard = new AIWasteGuard();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Wrap your API calls
const result = await guard.callOpenAI(
  async () => {
    return await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Hello!' }],
    });
  },
  'gpt-3.5-turbo',
  [{ role: 'user', content: 'Hello!' }]
);

if (result.success) {
  console.log('Response:', result.data);
} else if (result.blocked) {
  console.log('Blocked:', result.reason);
  console.log('Suggestions:', result.suggestions);
}
```

### Option B: Proxy Server

```bash
# Start the proxy server
aispend start

# Or with custom port
aispend start --port 4000
```

Then configure your AI SDK to use the proxy:

```javascript
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://localhost:3000/v1', // Point to AI Waste Guard proxy
});
```

## 🔧 CLI Commands

```bash
# Start the proxy server
aispend start

# View usage and savings report
aispend report

# View report for specific time period
aispend report --hours 168  # Last week

# View or update configuration
aispend config

# Update specific settings
aispend config --block-mode false
aispend config --max-cost 0.50
aispend config --waste-threshold 60

# Reset configuration to defaults
aispend config --reset

# View recently blocked requests
aispend blocked

# View last 20 blocked requests
aispend blocked --number 20
```

## ⚙️ Configuration

Configuration is stored in `~/.ai-waste-guard/config.json`:

```json
{
  "blockMode": true,
  "maxCostPerRequest": 1.0,
  "wasteThreshold": 50,
  "allowOverride": true,
  "proxyPort": 3000,
  "logRetentionDays": 30
}
```

### Settings

- **blockMode** - If true, blocks wasteful requests. If false, only warns.
- **maxCostPerRequest** - Maximum allowed cost per request (in dollars)
- **wasteThreshold** - Waste score threshold (0-100) to trigger blocking
- **allowOverride** - Allow programmatic override of blocks
- **proxyPort** - Port for the proxy server
- **logRetentionDays** - How long to keep logs

## 🎯 Waste Detection

The system detects:

1. **Repeated Prompts** - Same prompt sent multiple times within an hour
2. **Large Redundant Context** - Context much larger than the prompt
3. **Rapid Repeated Calls** - Multiple identical requests in 30 seconds (possible infinite loop)
4. **High Cost Requests** - Requests exceeding max cost threshold

### Example Output

```
🚫 Blocked request: 72% duplicate context detected. Estimated waste: $0.11
Suggestions:
- Enable caching for repeated prompts
- Store AI responses locally
- Remove duplicate files
```

## 📊 Reports

View your savings:

```bash
$ aispend report

📊 AI Waste Guard Report

Last 24 hours

Total Requests: 150
Blocked Requests: 18
Total Cost: $0.4523
Prevented Cost: $0.1123
Total Tokens: 45,230

💰 You saved $0.1123 by blocking 18 wasteful requests!
```

## 🧪 Demo

Run the demo to see AI Waste Guard in action:

```bash
npm run test
```

This will simulate various scenarios including:
- Normal requests (allowed)
- Duplicate requests (blocked)
- Large context detection (warned)
- Override functionality

## 📁 Project Structure

```
ai-waste-guard/
├── src/
│   ├── config/           # Pricing and user configuration
│   ├── token-counter/    # Token estimation
│   ├── waste-detection/  # Waste detection engine
│   ├── logger/           # SQLite logging
│   ├── proxy/            # Proxy server
│   ├── wrapper/          # SDK wrapper
│   ├── cli/              # CLI interface
│   └── examples/         # Usage examples
├── examples/             # Additional examples
├── package.json
├── tsconfig.json
└── README.md
```

## 🔒 Privacy

- **Local-first** - All data stored locally in `~/.ai-waste-guard/`
- **No remote tracking** - No data sent to external servers
- **No API keys stored** - Your API keys stay with your application

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev

# Run demo
npm run test
```

## 📝 Supported Models

### OpenAI
- GPT-4, GPT-4 Turbo, GPT-4 32K
- GPT-3.5 Turbo, GPT-3.5 Turbo 16K, GPT-3.5 Turbo Instruct

### Anthropic Claude
- Claude 3 Opus, Sonnet, Haiku
- Claude 2.1, Claude 2
- Claude Instant 1.2

## 🤝 Contributing

Contributions welcome! Please feel free to submit issues or pull requests.

## 📄 License

MIT

## 🙋 FAQ

**Q: Does this modify my API responses?**
A: No, it only analyzes requests before they're sent. Responses are returned unchanged.

**Q: Can I bypass the block for specific requests?**
A: Yes, use the `overrideBlock: true` option in the SDK wrapper.

**Q: How accurate is the token estimation?**
A: It uses a character-based approximation (~4 chars per token). For production use, consider integrating tiktoken for more accuracy.

**Q: What happens if the proxy server crashes?**
A: Your application will receive an error. We recommend implementing fallback logic in your application.

**Q: Can I use this with other AI providers?**
A: Currently supports OpenAI and Anthropic. Additional providers can be added by extending the proxy server.
