# AI Execution Firewall - Next.js Template

A production-ready Next.js template with AI Execution Firewall pre-installed for cost protection.

## Features

- ✅ OpenAI integration with automatic firewall protection
- ✅ API routes with cost monitoring
- ✅ Real-time alerts for blocked requests
- ✅ GitHub Actions CI/CD integration
- ✅ Daily budget protection ($50 default)

## Quick Start

```bash
# Create from template
npx create-next-app my-ai-app -e https://github.com/yourusername/aifw-nextjs-template

# Or install manually
npm install ai-execution-firewall
npx aifw init
```

## Project Structure

```
my-ai-app/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── chat/
│   │   │       └── route.ts      # Protected API endpoint
│   │   └── page.tsx               # Frontend
│   └── lib/
│       └── openai.ts              # Firewall-wrapped client
├── aifw.config.json               # Firewall configuration
└── .github/workflows/aifw.yml    # CI/CD integration
```

## Usage

### 1. API Route with Protection

```typescript
// src/app/api/chat/route.ts
import { guard } from '@salimassili/ai-costguard';
import OpenAI from 'openai';

const openai = guard(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
  trustMode: 'block',
  onBlock: (reason, score, cost) => {
    console.log(`🔥 BLOCKED: ${reason} (saved $${cost})`);
  }
});

export async function POST(request: Request) {
  const { prompt } = await request.json();
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }]
    });
    
    return Response.json({ 
      text: response.choices[0].message.content 
    });
  } catch (error: any) {
    if (error.error?.type === 'firewall_blocked') {
      return Response.json(
        { error: error.error.message, saved: error.error.saved },
        { status: 403 }
      );
    }
    throw error;
  }
}
```

### 2. Frontend Usage

```typescript
// src/app/page.tsx
'use client';

import { useState } from 'react';

export default function Home() {
  const [result, setResult] = useState('');
  const [saved, setSaved] = useState(0);

  async function generateText(prompt: string) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt })
    });
    
    const data = await res.json();
    
    if (res.status === 403) {
      setResult(`🔥 Blocked: ${data.error}`);
      setSaved(data.saved || 0);
    } else {
      setResult(data.text);
    }
  }

  return (
    <div>
      <h1>AI Chat (Protected)</h1>
      {saved > 0 && <div className="alert">💰 Saved ${saved}</div>}
      <button onClick={() => generateText('Hello')}>
        Generate
      </button>
      <p>{result}</p>
    </div>
  );
}
```

### 3. Configuration

Edit `aifw.config.json`:

```json
{
  "mode": "block",
  "dailyBudget": 50,
  "riskThreshold": 70,
  "spikeLimit": 20,
  "duplicateWindow": 30
}
```

### 4. Run Dashboard

```bash
npx ai-execution-firewall dashboard
```

## Deployment

### Vercel

```bash
vercel --prod
```

### Environment Variables

```bash
OPENAI_API_KEY=sk-...
# Optional: AIFW_API_KEY for proxy mode
```

## Learn More

- [AI Execution Firewall Docs](https://github.com/yourusername/ai-execution-firewall)
- [Next.js Documentation](https://nextjs.org/docs)
