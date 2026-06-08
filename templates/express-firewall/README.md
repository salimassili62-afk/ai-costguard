# Express + AI CostGuard Template

Minimal Express server using `@salimassili/ai-costguard`.

## What This Template Includes

- OpenAI SDK client wrapped with `guard()`
- Express middleware that exposes `req.localSafety` for manual checks
- `/api/chat` endpoint with `GuardError` handling
- `/api/estimate` endpoint using the package pricing registry
- `aifw check` script for CI budget estimates

It does not include a dashboard, proxy server, request authentication, or hosted telemetry.

## Quick Start

```bash
cp -r templates/express-firewall my-api-server
cd my-api-server
npm install
cp .env.example .env
npm run build
npm start
```

## Environment

```bash
OPENAI_API_KEY=sk-your-api-key-here
PORT=3000
NODE_ENV=development
```

## CLI Budget Check

```bash
npm run ai:check -- --budget 1 --model gpt-4o-mini --tokens 1000 --max-steps 5
```

## Block Response

When AI CostGuard blocks a request, `/api/chat` returns:

```json
{
  "error": "Blocked by AI CostGuard",
  "code": "BUDGET_EXCEEDED",
  "reason": "Budget exceeded: estimated $...",
  "context": {
    "model": "gpt-4o-mini",
    "estimatedCost": 0.001
  }
}
```
