# Next.js + AI CostGuard Template

Minimal Next.js app using `@salimassili/ai-costguard`.

## What This Template Includes

- OpenAI SDK client wrapped with `guard()`
- `/api/chat` route with `GuardError` handling
- Small client UI that displays block code and estimated blocked cost
- `aifw check` script for CI budget estimates

It does not include a dashboard, proxy server, request authentication, or hosted telemetry.

## Quick Start

```bash
cp -r templates/nextjs-costguard my-ai-app
cd my-ai-app
npm install
cp .env.example .env.local
npm run dev
```

Create `.env.local`:

```bash
OPENAI_API_KEY=sk-your-api-key-here
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
  "code": "LOOP_DETECTED",
  "reason": "Loop detected: ...",
  "context": {
    "model": "gpt-4o-mini",
    "estimatedCost": 0.001
  }
}
```
