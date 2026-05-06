import { performance } from 'perf_hooks';
import { estimateCost } from './costEstimator';
import { LoopDetector } from './loopDetector';
import { createPolicy } from './policy';
import { DecisionExplanation, GuardPolicy, GuardRequest, GuardResult } from './types';

/**
 * This is not a framework.
 * It is a pre-execution cost + safety enforcement layer for AI systems.
 */
export class ExecutionGuard {
  private readonly policy: GuardPolicy;
  private readonly loops: LoopDetector;
  private readonly minuteWindow = new Map<string, number[]>();

  constructor(policyOverrides: Partial<GuardPolicy> = {}) {
    this.policy = createPolicy(policyOverrides);
    this.loops = new LoopDetector(this.policy.loopWindowMs, this.policy.loopThreshold);
  }

  evaluate(request: GuardRequest): GuardResult {
    const start = performance.now();
    const normalizedPrompt = request.prompt?.trim();

    if (!normalizedPrompt) {
      return this.result('block', 'empty prompt', 0, 0, start, undefined, 'input-validation-v1');
    }

    const estimate = estimateCost(request.model, normalizedPrompt, request.maxOutputTokens);
    const scopeKey = String(request.metadata?.sessionId ?? request.metadata?.userId ?? 'default');
    const loop = this.loops.inspect(scopeKey, normalizedPrompt);

    if (loop.isLooping) {
      return this.result(
        'block',
        `loop detected (${loop.loopCount} repeats in ${(this.policy.loopWindowMs / 1000).toFixed(0)}s)`,
        estimate.estimatedUsd,
        loop.loopCount,
        start,
        undefined,
        'loop-protection-v1'
      );
    }

    if (this.isRateLimited(scopeKey)) {
      return this.result(
        'throttle',
        'burst traffic detected',
        estimate.estimatedUsd,
        loop.loopCount,
        start,
        500,
        'rate-limit-v1'
      );
    }

    if (estimate.estimatedUsd >= this.policy.maxCostUsd) {
      return this.result(
        'block',
        'predicted cost exceeds max policy',
        estimate.estimatedUsd,
        loop.loopCount,
        start,
        undefined,
        'cost-cap-v1'
      );
    }

    if (estimate.estimatedUsd >= this.policy.throttleCostUsd) {
      return this.result(
        'throttle',
        'predicted cost near budget threshold',
        estimate.estimatedUsd,
        loop.loopCount,
        start,
        this.policy.strict ? 0 : 300,
        'cost-throttle-v1'
      );
    }

    return this.result('allow', 'request approved', estimate.estimatedUsd, loop.loopCount, start, undefined, 'allow-v1');
  }

  getPolicy(): GuardPolicy {
    return { ...this.policy };
  }

  reset(): void {
    this.loops.reset();
    this.minuteWindow.clear();
  }

  explainDecision(result: GuardResult): DecisionExplanation {
    return {
      decision: result.decision,
      reason: result.reason,
      costAvoided: result.costAvoidedUsd,
      ruleTriggered: result.ruleTriggered,
    };
  }

  private isRateLimited(scopeKey: string): boolean {
    const now = Date.now();
    const history = this.minuteWindow.get(scopeKey) ?? [];
    const recent = history.filter(at => now - at <= 60_000);
    recent.push(now);
    this.minuteWindow.set(scopeKey, recent);
    return recent.length > this.policy.requestsPerMinute;
  }

  private result(
    decision: GuardResult['decision'],
    reason: string,
    estimatedCostUsd: number,
    loopCount: number,
    start: number,
    throttleMs?: number,
    ruleTriggered = 'policy-v1'
  ): GuardResult {
    const costAvoidedUsd = decision === 'allow' ? 0 : estimatedCostUsd;
    return {
      decision,
      reason,
      estimatedCostUsd,
      costAvoidedUsd,
      loopCount,
      throttleMs,
      ruleTriggered,
      policy: this.getPolicy(),
      latencyMs: Number((performance.now() - start).toFixed(3)),
    };
  }
}
