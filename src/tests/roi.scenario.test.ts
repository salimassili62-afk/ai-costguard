import { detectionEngine } from '../core/DetectionEngine';

describe('ROI scenario proof', () => {
  beforeEach(() => {
    detectionEngine.reset();
  });

  test('loop scenario blocks and reports cost saved', () => {
    const prompt = 'repeat-loop-scenario';
    let finalDecision = 'allow';

    for (let i = 0; i < 4; i++) {
      const result = detectionEngine.analyze({
        model: 'gpt-4',
        prompt,
        estimatedCost: 0.12,
        trustMode: 'block',
      });
      finalDecision = result.decision;
    }

    const metrics = detectionEngine.getOperationalMetrics(24);
    expect(finalDecision).toBe('block');
    expect(metrics.blocked_requests_count).toBeGreaterThanOrEqual(1);
    expect(metrics.total_cost_saved).toBeGreaterThan(0);
  });
});
