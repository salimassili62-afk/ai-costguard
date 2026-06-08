import express from 'express';
import OpenAI from 'openai';
import { guard, GuardError } from '@salimassili/ai-costguard';

const app = express();
app.use(express.json());

const openai = guard(new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' }), {
  budget: 10,
  maxSteps: 50,
  scope: { projectId: 'production-api' },
});

app.get('/metrics', (_req, res) => {
  const state = openai.getGuardState();
  res.type('text/plain').send(
    [
      `ai_costguard_requests_total ${state.requestCount}`,
      `ai_costguard_blocks_total ${state.blockedCount}`,
      `ai_costguard_estimated_spend_usd ${state.totalCost}`,
      `ai_costguard_blocked_spend_usd ${state.blockedCost}`,
    ].join('\n') + '\n'
  );
});

app.post('/api/agent/run', async (req, res, next) => {
  try {
    const response = await openai.chat.completions.create({
      model: req.body.model ?? 'gpt-4o-mini',
      messages: [{ role: 'user', content: String(req.body.prompt ?? '') }],
      max_tokens: Number(req.body.max_tokens ?? 300),
    });

    res.json({ ok: true, text: response.choices[0]?.message?.content ?? '' });
  } catch (error) {
    if (error instanceof GuardError) {
      res.status(403).json({ ok: false, code: error.code, reason: error.message, context: error.context });
      return;
    }
    next(error);
  }
});

app.listen(3000, () => {
  console.log('AI CostGuard example server listening on http://localhost:3000');
});
