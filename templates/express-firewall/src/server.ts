/**
 * Express Server with AI CostGuard
 *
 * This server demonstrates middleware and SDK wrapper protection.
 */

import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { guard, middleware, GuardError, getPricing } from '@salimassili/ai-costguard';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(middleware({ budget: 50 }));

const openai = guard(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  {
    budget: 50,
    scope: { projectId: 'express-template' },
  }
);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', guard: 'active' });
});

app.post('/api/chat', async (req: Request, res: Response) => {
  const { prompt, model = 'gpt-4' } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1000,
    });

    const responseText = completion.choices[0]?.message?.content || '';

    res.json({
      text: responseText,
      model,
      usage: completion.usage,
    });
  } catch (error: unknown) {
    if (error instanceof GuardError) {
      return res.status(403).json({
        error: 'Blocked by AI CostGuard',
        code: error.code,
        reason: error.message,
        context: error.context,
      });
    }

    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

app.post('/api/estimate', async (req: Request, res: Response) => {
  const { prompt, model = 'gpt-4' } = req.body;

  const pricing = getPricing(model);
  if (!pricing) {
    return res.status(400).json({
      error: 'Unknown model pricing',
      message: 'Choose a known model or configure pricingOverrides in your application.',
    });
  }

  const inputTokens = Math.ceil(String(prompt ?? '').length / 4);
  const outputTokens = 1000;
  const totalCost = (inputTokens / 1000) * pricing.inputPer1kTokens + (outputTokens / 1000) * pricing.outputPer1kTokens;

  res.json({
    prompt,
    model,
    inputTokens,
    outputTokens,
    estimatedCost: Math.round(totalCost * 10000) / 10000,
  });
});

app.get('/api/stats', (_req: Request, res: Response) => {
  res.json({
    message: 'AI CostGuard is active',
  });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

app.listen(PORT, () => {
  console.log('Express Server with AI CostGuard');
  console.log(`Running on http://localhost:${PORT}`);
});
