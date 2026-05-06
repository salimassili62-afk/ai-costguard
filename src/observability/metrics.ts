import { TelemetryStore } from '../saas/telemetry';

export class MetricsExporter {
  constructor(private readonly telemetry: TelemetryStore) {}

  toJson() {
    return this.telemetry.getSummary();
  }

  toPrometheus(): string {
    const summary = this.telemetry.getSummary();
    return [
      '# HELP firewall_decisions_total Total decision count',
      '# TYPE firewall_decisions_total counter',
      `firewall_decisions_total ${summary.totalDecisions}`,
      '# HELP firewall_blocked_total Blocked request count',
      '# TYPE firewall_blocked_total counter',
      `firewall_blocked_total ${summary.blocked}`,
      '# HELP firewall_allowed_total Allowed request count',
      '# TYPE firewall_allowed_total counter',
      `firewall_allowed_total ${summary.allowed}`,
      '# HELP firewall_cost_saved_usd Estimated USD saved',
      '# TYPE firewall_cost_saved_usd gauge',
      `firewall_cost_saved_usd ${summary.costSavedEstimateUsd}`,
      '# HELP firewall_latency_ms Average decision latency in ms',
      '# TYPE firewall_latency_ms gauge',
      `firewall_latency_ms ${summary.avgLatencyImpactMs}`,
    ].join('\n');
  }

  metricsHandler() {
    return this.toPrometheus();
  }
}
