import express from 'express';
import OpenAI from 'openai';
import { createClient, withFirewall } from '../src';

const firewall = createClient({
  apiKey: process.env.FIREWALL_API_KEY ?? 'dev-key',
  policy: {
    maxCostUsd: 0.2,
    throttleCostUsd: 0.08,
    loopThreshold: 3,
    strict: true,
  },
});

const app = express();
app.use(express.json());

// GET /metrics compatibility (Prometheus style output)
app.get('/metrics', (_req, res) => {
  res.type('text/plain').send(firewall.metricsPrometheus());
});

// Production API safety layer
app.post('/api/agent/run', (req, res) => {
  const result = firewall.evaluate({
    model: req.body.model ?? 'gpt-4o-mini',
    prompt: String(req.body.prompt ?? ''),
    maxOutputTokens: Number(req.body.max_tokens ?? 300),
    metadata: { sessionId: req.body.sessionId, requestId: req.body.requestId },
  });

  if (result.decision === 'block') {
    return res.status(403).json({ ...firewall.guard.explainDecision(result), saved: result.costAvoidedUsd });
  }
  return res.json({ decision: result.decision, ok: true });
});

// OpenAI wrapper usage
const openai = withFirewall(new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' }), {
  policy: { strict: true, maxCostUsd: 0.1 },
});

async function runLoopProtectionDemo() {
  const request = {
    model: 'gpt-4o-mini',
    prompt: 'repeat this exact prompt',
    metadata: { sessionId: 'loop-demo' },
  };
  firewall.evaluate(request);
  firewall.evaluate(request);
  const third = firewall.evaluate(request);
  console.log('loop protection decision:', third.decision); // expected: block
}

app.listen(3000, () => {
  runLoopProtectionDemo().catch(() => undefined);
  openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hello from production setup.' }],
  });
});
