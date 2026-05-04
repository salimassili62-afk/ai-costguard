import { createCliOutputContract, validateCliOutputContract } from '../cli/outputContract';

describe('CLI Output Contract', () => {
  test('validates frozen schema shape', () => {
    const output = createCliOutputContract(
      'report',
      { hours: 24, stats: { totalRequests: 1 } },
      {
        total_cost_saved: 1.23,
        blocked_requests_count: 2,
        false_positive_indicator: 0.1,
        avg_analysis_latency_ms: 1.5,
        storage_backend: 'file',
      }
    );
    expect(validateCliOutputContract(output)).toBe(true);
  });

  test('snapshot protects output contract', () => {
    const output = createCliOutputContract(
      'metrics',
      { hours: 24 },
      {
        total_cost_saved: 10.5,
        blocked_requests_count: 7,
        false_positive_indicator: 0.2,
        avg_analysis_latency_ms: 0.9,
        storage_backend: 'redis',
      }
    );
    expect(output).toMatchSnapshot({
      timestamp: expect.any(String),
    });
  });
});
