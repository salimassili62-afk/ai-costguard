# Next.js + AI Execution Firewall Template

A production-ready Next.js template with AI Execution Firewall pre-installed for cost protection.

## Features

- ✅ OpenAI integration with automatic firewall protection
- ✅ API routes with cost monitoring and blocking
- ✅ Real-time alerts for blocked requests
- ✅ Daily budget enforcement ($50 default)
- ✅ GitHub Actions CI/CD integration
- ✅ Pre-configured risk thresholds

## Quick Start

```bash
# Copy template
cp -r templates/nextjs-firewall my-ai-app
cd my-ai-app

# Install dependencies
npm install

# Set environment variables
cp .env.example .env.local
# Edit .env.local with your OpenAI API key

# Run development server
npm run dev
```

## Project Structure

```
my-ai-app/
├── src/
│   ├── app/
│   │   ├── api/chat/route.ts    # Protected API endpoint
│   │   ├── page.tsx              # Frontend
│   │   ├── layout.tsx            # Root layout
│   │   └── globals.css           # Global styles
│   └── lib/
│       └── openai.ts            # Firewall-wrapped client
├── aifw.config.json              # Firewall configuration
├── next.config.mjs               # Next.js config
└── package.json
```

## Configuration

### Environment Variables

Create `.env.local`:

```
OPENAI_API_KEY=sk-your-api-key-here
```

### Firewall Config (aifw.config.json)

```json
{
  "defaultMode": "block",      // 'block' | 'warn' | 'monitor'
  "riskThreshold": 50,         // 0-100
  "budgetPerDay": 50,         // USD
  "logging": true,
  "maxCost": 5                // Max per request
}
```

## Usage

### 1. API Route (Already Protected)

The `/api/chat` route uses the protected OpenAI client:

```typescript
import { openai } from '@/lib/openai';

// Automatically protected - firewall intercepts before execution
const completion = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: prompt }],
});
```

### 2. Handling Firewall Blocks

The API returns 403 when a request is blocked:

```typescript
const res = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ prompt }),
});

if (res.status === 403) {
  const data = await res.json();
  console.log('Blocked:', data.reason);
  console.log('Saved: $', data.saved);
}
```

### 3. CLI Commands

```bash
# Check a prompt
npm run ai:check -- "generate code"

# View dashboard
npm run ai:dashboard

# Set budget
npm run ai:budget -- --set 100
```

## Protection Features

### Automatic Blocking

- **Duplicate requests** - Same prompt within 30s → BLOCKED
- **Cost spikes** - Requests >$5 → BLOCKED
- **Daily budget** - Exceeds $50/day → BLOCKED
- **Risk threshold** - Score ≥50 → BLOCKED

### Alerts

```
🔥 AI FIREWALL BLOCKED: duplicate request
   Danger Score: 75
   SAVED: $0.0240
```

## Deployment

### Vercel

```bash
vercel --prod
```

### Environment Variables

Set in Vercel dashboard:
- `OPENAI_API_KEY`

## Learn More

- [AI Execution Firewall Docs](https://github.com/salimassili62-afk/ai-waste-guard)
- [Next.js Documentation](https://nextjs.org/docs)
