import express from 'express';
import { GuardError, middleware } from '@salimassili/ai-costguard';

const app = express();
app.use(express.json());
app.use(middleware({ budget: 2 }));

app.post('/chat', async (req, res, next) => {
  try {
    const guard = (req as any).localSafety;
    guard.check({
      model: 'gpt-4o-mini',
      tokens: 500,
      inputTokens: 100,
      outputTokens: 400,
      estimatedCost: 0.0003,
      timestamp: Date.now(),
      prompt: String(req.body?.prompt ?? ''),
      scope: { projectId: 'express-example' },
      scopeKey: 'project:express-example|user:*|session:*',
    });

    res.json({ ok: true, reply: `Echo: ${req.body?.prompt ?? ''}` });
  } catch (error) {
    if (error instanceof GuardError) {
      res.status(403).json({ error: error.code, reason: error.message, context: error.context });
      return;
    }
    next(error);
  }
});

app.listen(3000, () => {
  console.log('AI CostGuard Express example listening on http://localhost:3000');
});
