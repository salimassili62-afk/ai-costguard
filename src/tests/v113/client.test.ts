import { createClient } from '../../client';

describe('SaaS client', () => {
  test('captures telemetry and returns dashboard metrics', () => {
    const client = createClient({ apiKey: 'k_test', policy: { maxCostUsd: 0.001 } });
    client.evaluate({ model: 'gpt-4o', prompt: 'test', maxOutputTokens: 1000 });

    const metrics = client.metrics();
    expect(metrics.totalDecisions).toBe(1);

    const dashboard = JSON.parse(client.dashboardJson()) as { apiKey: string };
    expect(dashboard.apiKey).toBe('k_test');
  });

  test('explains blocked decisions with rule id', () => {
    const client = createClient({ apiKey: 'k_test2', policy: { loopThreshold: 2 } });
    const request = { model: 'gpt-4o-mini', prompt: 'repeat', metadata: { sessionId: 's1' } };
    client.evaluate(request);
    const explanation = client.explainDecision(request);

    expect(explanation.decision).toBe('block');
    expect(explanation.ruleTriggered).toContain('loop-protection');
  });
});
