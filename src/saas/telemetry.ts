import { GuardDecision } from '../firewall/types';

export interface TelemetryEvent {
  apiKey: string;
  requestId: string;
  decision: GuardDecision;
  estimatedCostUsd: number;
  costAvoidedUsd: number;
  latencyMs: number;
  at: number;
}

export class TelemetryStore {
  private events: TelemetryEvent[] = [];

  capture(event: TelemetryEvent): void {
    this.events.push(event);
  }

  getSummary() {
    const total = this.events.length;
    const blocked = this.events.filter(e => e.decision === 'block').length;
    const allowed = this.events.filter(e => e.decision === 'allow').length;
    const throttled = this.events.filter(e => e.decision === 'throttle').length;
    const costSavedEstimate = this.events.reduce((sum, e) => sum + e.costAvoidedUsd, 0);
    const avgLatencyMs =
      total === 0 ? 0 : this.events.reduce((sum, e) => sum + e.latencyMs, 0) / total;

    return {
      totalDecisions: total,
      blocked,
      allowed,
      throttled,
      blockedVsAllowedRatio: allowed === 0 ? blocked : blocked / allowed,
      costSavedEstimateUsd: Number(costSavedEstimate.toFixed(6)),
      avgLatencyImpactMs: Number(avgLatencyMs.toFixed(3)),
    };
  }
}
