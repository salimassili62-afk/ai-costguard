export const CLI_CONTRACT_VERSION = '1.0.0' as const;

export interface CliMetricsContract {
  total_cost_saved: number;
  blocked_requests_count: number;
  false_positive_indicator: number;
  avg_analysis_latency_ms: number;
  storage_backend: 'file' | 'redis';
}

export interface CliOutputContract<TPayload = Record<string, unknown>> {
  schema: 'aifw.cli.output';
  version: typeof CLI_CONTRACT_VERSION;
  command: string;
  timestamp: string;
  payload: TPayload;
  metrics: CliMetricsContract;
}

export function createCliOutputContract<TPayload>(
  command: string,
  payload: TPayload,
  metrics: CliMetricsContract
): CliOutputContract<TPayload> {
  const output: CliOutputContract<TPayload> = {
    schema: 'aifw.cli.output',
    version: CLI_CONTRACT_VERSION,
    command,
    timestamp: new Date().toISOString(),
    payload,
    metrics,
  };

  validateCliOutputContract(output);
  return output;
}

export function validateCliOutputContract(value: unknown): value is CliOutputContract {
  const candidate = value as CliOutputContract;
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Invalid CLI contract: expected object');
  }
  if (candidate.schema !== 'aifw.cli.output') {
    throw new Error('Invalid CLI contract: schema mismatch');
  }
  if (candidate.version !== CLI_CONTRACT_VERSION) {
    throw new Error('Invalid CLI contract: unsupported version');
  }
  if (typeof candidate.command !== 'string' || candidate.command.length === 0) {
    throw new Error('Invalid CLI contract: command required');
  }
  if (typeof candidate.timestamp !== 'string' || Number.isNaN(Date.parse(candidate.timestamp))) {
    throw new Error('Invalid CLI contract: timestamp invalid');
  }
  if (!candidate.metrics || typeof candidate.metrics !== 'object') {
    throw new Error('Invalid CLI contract: metrics missing');
  }
  const metrics = candidate.metrics;
  const numericFields = [
    metrics.total_cost_saved,
    metrics.blocked_requests_count,
    metrics.false_positive_indicator,
    metrics.avg_analysis_latency_ms,
  ];
  if (numericFields.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
    throw new Error('Invalid CLI contract: numeric metrics invalid');
  }
  if (metrics.storage_backend !== 'file' && metrics.storage_backend !== 'redis') {
    throw new Error('Invalid CLI contract: storage_backend invalid');
  }
  return true;
}
