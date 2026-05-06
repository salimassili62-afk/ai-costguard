import { ExecutionGuard } from '../../firewall/executionGuard';

describe('ExecutionGuard v1.1.3', () => {
  test('allows low-cost request', () => {
    const guard = new ExecutionGuard();
    const result = guard.evaluate({
      model: 'gpt-4o-mini',
      prompt: 'Summarize this note in three bullets.',
      maxOutputTokens: 120,
    });

    expect(result.decision).toBe('allow');
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });

  test('blocks runaway loop', () => {
    const guard = new ExecutionGuard({ loopThreshold: 3, loopWindowMs: 30_000 });
    const req = {
      model: 'gpt-4o-mini',
      prompt: 'Repeat the same request.',
      metadata: { sessionId: 'abc' },
    };

    guard.evaluate(req);
    guard.evaluate(req);
    const result = guard.evaluate(req);

    expect(result.decision).toBe('block');
    expect(result.reason).toContain('loop detected');
  });

  test('blocks high-cost request before execution', () => {
    const guard = new ExecutionGuard({ maxCostUsd: 0.01 });
    const result = guard.evaluate({
      model: 'gpt-4o',
      prompt: 'Very long response',
      maxOutputTokens: 20_000,
    });

    expect(result.decision).toBe('block');
    expect(result.reason).toContain('cost');
  });
});
