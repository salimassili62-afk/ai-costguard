import { detectionEngine } from '../core/DetectionEngine';
import { performance } from 'perf_hooks';

describe('Detection benchmark', () => {
  beforeEach(() => {
    detectionEngine.reset();
  });

  test('average interception latency stays under 10ms', () => {
    const iterations = 300;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      detectionEngine.analyze({
        model: 'gpt-4',
        prompt: `benchmark-${i}`,
        estimatedCost: 0.01,
        trustMode: 'warn',
      });
    }
    const avgMs = (performance.now() - start) / iterations;
    expect(avgMs).toBeLessThan(10);
  });
});
