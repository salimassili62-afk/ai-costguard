# Express + AI Execution Firewall Template

A production-ready Express server template with AI Execution Firewall pre-installed for cost protection.

## Features

- ✅ Global firewall middleware for all routes
- ✅ Cost tracking per endpoint
- ✅ Real-time blocking with custom handlers
- ✅ Budget enforcement per request
- ✅ Double protection (middleware + SDK wrapper)
- ✅ GitHub Actions CI/CD integration

## Quick Start

```bash
# Copy template
cp -r templates/express-firewall my-api-server
cd my-api-server

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your OpenAI API key

# Build and run
npm run build
npm start

# Or run in development mode
npm run dev
```

## Project Structure

```
my-api-server/
├── src/
│   └── server.ts                 # Express server with firewall
├── dist/                         # Compiled output
├── aifw.config.json              # Firewall configuration
├── .env                          # Environment variables
├── .env.example                  # Example environment
├── package.json
└── tsconfig.json
```

## Configuration

### Environment Variables

Create `.env`:

```
OPENAI_API_KEY=sk-your-api-key-here
PORT=3000
NODE_ENV=production
```

### Firewall Config (aifw.config.json)

```json
{
  "defaultMode": "block",
  "riskThreshold": 50,
  "budgetPerDay": 50,
  "logging": true,
  "maxCost": 5
}
```

## Usage

### 1. Server with Global Protection

The server automatically protects all AI routes:

```typescript
// Global firewall middleware
app.use(expressFirewall({
  trustMode: 'block',
  dailyBudget: 50,
  maxCost: 5,
  onBlock: (req, res, reason, details) => {
    res.status(403).json({
      error: 'Blocked by AI Firewall',
      saved: details.estimatedCost,
    });
  },
}));
```

### 2. API Endpoints

**Chat endpoint (protected):**
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, how are you?"}'
```

**Cost estimate (safe):**
```bash
curl -X POST http://localhost:3000/api/estimate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Tell me about AI"}'
```

**Health check (bypasses firewall):**
```bash
curl http://localhost:3000/health
```

### 3. Handling Firewall Blocks

When a request is blocked, the API returns:

```json
{
  "error": "Request blocked by AI Execution Firewall",
  "reason": "duplicate request",
  "saved": 0.024,
  "wouldHaveLost": 1.45,
  "risk": "MEDIUM"
}
```

### 4. CLI Commands

```bash
# Check a prompt
npm run ai:check -- "generate code"

# View dashboard
npm run ai:dashboard

# Set budget
npm run ai:budget -- --set 100
```

## Protection Features

### Double Protection

1. **Global Middleware** - Analyzes ALL requests before they reach handlers
2. **SDK Wrapper** - Also analyzes at the OpenAI client level

### Automatic Blocking

- **Duplicate requests** - Same prompt within 30s
- **Cost spikes** - Requests >$5
- **Daily budget** - Exceeds $50/day
- **Risk threshold** - Score ≥50

### Alert Format

```
🔥 BLOCKED: duplicate request
   SAVED: $0.0240
```

## Deployment

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t my-api-server .
docker run -p 3000:3000 -e OPENAI_API_KEY=$OPENAI_API_KEY my-api-server
```

### Environment

Set in your deployment platform:
- `OPENAI_API_KEY`
- `PORT` (optional, defaults to 3000)
- `NODE_ENV=production`

## Learn More

- [AI Execution Firewall Docs](https://github.com/salimassili62-afk/ai-waste-guard)
- [Express.js Documentation](https://expressjs.com/)
