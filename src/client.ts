import { randomUUID } from 'crypto';
import { ExecutionGuard } from './firewall/executionGuard';
import { estimateCost } from './firewall/costEstimator';
import { GuardPolicy, GuardRequest } from './firewall/types';
import { withFirewall } from './middleware/withFirewall';
import { MetricsExporter } from './observability/metrics';
import { AuditLogger } from './observability/logger';
import { BillingMetrics } from './saas/billingMetrics';
import { TelemetryStore } from './saas/telemetry';
import { UsageLimitConfig, UsageMeter } from './saas/usageMeter';

/**
 * This is not a framework.
 * It is a pre-execution cost + safety enforcement layer for AI systems.
 */
export interface ClientConfig {
  apiKey: string;
  policy?: Partial<GuardPolicy>;
  usageLimits?: Partial<UsageLimitConfig>;
  auditLogPath?: string;
}

export interface FirewallClient {
  guard: ExecutionGuard;
  estimateCost: typeof estimateCost;
  withFirewall: typeof withFirewall;
  evaluate: (request: GuardRequest) => ReturnType<ExecutionGuard['evaluate']>;
  explainDecision: (request: GuardRequest) => ReturnType<ExecutionGuard['explainDecision']>;
  metrics: () => ReturnType<MetricsExporter['toJson']>;
  metricsPrometheus: () => string;
  dashboardJson: () => string;
}

export function createClient(config: ClientConfig): FirewallClient {
  const guard = new ExecutionGuard(config.policy);
  const telemetry = new TelemetryStore();
  const usage = new UsageMeter(config.usageLimits);
  const billing = new BillingMetrics();
  const metrics = new MetricsExporter(telemetry);
  const logger = new AuditLogger(config.auditLogPath);

  const evaluate: FirewallClient['evaluate'] = request => {
    const requestId = String(request.metadata?.requestId ?? randomUUID());
    const result = guard.evaluate(request);
    telemetry.capture({
      apiKey: config.apiKey,
      requestId,
      decision: result.decision,
      estimatedCostUsd: result.estimatedCostUsd,
      costAvoidedUsd: result.costAvoidedUsd,
      latencyMs: result.latencyMs,
      at: Date.now(),
    });
    usage.track(config.apiKey, result.estimatedCostUsd);
    logger.log({
      timestamp: new Date().toISOString(),
      requestId,
      decision: result.decision,
      estimatedCostUsd: result.estimatedCostUsd,
      latencyMs: result.latencyMs,
      reason: result.reason,
    });
    return result;
  };

  return {
    guard,
    estimateCost,
    withFirewall,
    evaluate,
    explainDecision: request => guard.explainDecision(evaluate(request)),
    metrics: () => metrics.toJson(),
    metricsPrometheus: () => metrics.metricsHandler(),
    dashboardJson: () =>
      billing.exportDashboardJson(
        billing.compute(config.apiKey, telemetry, usage.getSnapshot(config.apiKey))
      ),
  };
}

export function initFirewall(config: ClientConfig): FirewallClient {
  return createClient(config);
}
