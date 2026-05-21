import express from 'express';
import OpenAI from 'openai';
import { guard, GuardError } from '../src';

const app = express();
app.use(express.json());

const openai = guard(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' }),
  { budget: 10 }
);

app.get('/metrics', (_req, res) => {
  res.type('text/plain').send('ai_costguard_active 1\n');
});

app.post('/api/agent/run', async (req, res) => {
  try {
    const response = await openai.chat.completions.create({
      model: req.body.model ?? 'gpt-4o-mini',
      messages: [{ role: 'user', content: String(req.body.prompt ?? '') }],
      max_tokens: Number(req.body.max_tokens ?? 300),
    });

    return res.json({ ok: true, text: response.choices[0]?.message?.content ?? '' });
  } catch (error) {
    if (error instanceof GuardError) {
      return res.status(403).json({ ok: false, reason: error.message, context: error.context });
    }
    throw error;
  }
});

app.listen(3000, () => {
  console.log('AI CostGuard example server listening on http://localhost:3000');
});
