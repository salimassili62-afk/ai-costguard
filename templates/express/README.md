# AI Execution Firewall - Express Template

A production-ready Express server template with AI Execution Firewall global middleware protection.

## Features

- ✅ Global firewall middleware for all routes
- ✅ Cost tracking per endpoint
- ✅ Real-time blocking with custom handlers
- ✅ Budget enforcement per request
- ✅ GitHub Actions CI/CD

## Quick Start

```bash
# Install dependencies
npm install

# Initialize firewall configuration
npx aifw init

# Start server
npm start
```

## Project Structure

```
express-server/
├── src/
│   ├── server.ts                  # Express server with firewall
│   ├── routes/
│   │   └── chat.ts               # AI chat endpoints
│   └── middleware/
│       └── aiFirewall.ts         # Firewall configuration
├── aifw.config.json              # Firewall settings
└── .github/workflows/aifw.yml   # CI/CD
```

## Usage

### 1. Basic Server with Firewall

```typescript
// src/server.ts
import express from 'express';
import { expressFirewall } from 'ai-execution-firewall';
import chatRoutes from './routes/chat';

const app = express();

// Global AI Firewall - protects ALL routes
app.use(expressFirewall({
  trustMode: 'block',
  dailyBudget: 50,
  onBlock: (req, res, reason, details) => {
    res.status(403).json({
      error: 'Request blocked by AI Firewall',
      reason,
      saved: details.estimatedCost,
      wouldHaveLost: details.wouldHaveLost
    });
  }
}));

app.use(express.json());
app.use('/api/chat', chatRoutes);

app.listen(3000, () => {
  console.log('🛡️  Server protected by AI Execution Firewall');
});
```

### 2. Route Handler

```typescript
// src/routes/chat.ts
import { Router } from 'express';
import { guard } from '@salimassili/ai-costguard';
import OpenAI from 'openai';

const router = Router();
const openai = guard(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), { budget: 50 });

router.post('/', async (req, res) => {
  const { prompt } = req.body;
  
  // This call is automatically protected by global middleware
  // AND double-protected by SDK wrapper
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }]
  });
  
  res.json({
    text: response.choices[0].message.content,
    // Cost info attached by middleware
    cost: (req as any).aiFirewall?.cost,
    risk: (req as any).aiFirewall?.risk
  });
});

export default router;
```

### 3. Per-Route Override

```typescript
// Override global settings for specific routes
import { middleware } from '@salimassili/ai-costguard';

router.post('/expensive',
  middleware({ budget: 50 }),
  async (req, res) => {
    // This route allows higher costs but warns
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      max_tokens: 4000,
      messages: [{ role: 'user', content: req.body.prompt }]
    });
    res.json({ text: response.choices[0].message.content });
  }
);
```

### 4. Health Check (No Firewall)

```typescript
// Routes that skip firewall
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});
```

## Configuration

### aifw.config.json

```json
{
  "mode": "block",
  "dailyBudget": 50,
  "riskThreshold": 70,
  "spikeLimit": 20,
  "duplicateWindow": 30
}
```

### Environment Variables

```bash
OPENAI_API_KEY=sk-...
PORT=3000
NODE_ENV=production
```

## CLI Commands

```bash
# Check a prompt
npx aifw check "generate code" --model gpt-4

# View dashboard
npx aifw dashboard

# Set budget
npx aifw budget --set 100

# CI check
npx aifw ci --fail-on HIGH
```

## Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t my-ai-server .
docker run -p 3000:3000 -e OPENAI_API_KEY=$OPENAI_API_KEY my-ai-server
```

## Learn More

- [AI Execution Firewall Docs](https://github.com/yourusername/ai-execution-firewall)
- [Express.js Documentation](https://expressjs.com/)
