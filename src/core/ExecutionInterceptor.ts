/**
 * ExecutionInterceptor.ts - DEPRECATED
 *
 * This module has been superseded by ExecutionOS.
 * Please use the new AI Execution Operating System from src/os/
 *
 * Migration:
 *   Old: const interceptor = new ExecutionInterceptor(config);
 *   New: const os = new ExecutionOS(config);
 *        const client = wrapOpenAI(os, openai, agentId);
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

// Type definitions
export interface ExecutionRequest {
  id: string;
  type: string;
  provider: string;
  action: string;
  input: any;
  estimatedCost: number;
  context: {
    tenantId: string;
    sessionId: string;
    agentId: string;
  };
}

export type ExecutionDecision = 'allow' | 'block' | 'throttle';

export type InterceptionMode = 'sync' | 'async' | 'non-blocking';

export interface ExecutionExplanation {
  summary: string;
  details: string[];
  policyRules: string[];
  behaviorGraph?: {
    workflowStep: number;
    loopDetected: boolean;
    redundancyScore: number;
  };
  costBreakdown?: {
    currentCost: number;
    predictedRemaining: number;
    totalBudget: number;
  };
}

export interface ExecutionDecisionResult {
  decision: ExecutionDecision;
  reason: string;
  confidence: number;
  latencyMs?: number;
  policyRulesTriggered: string[];
  explanation?: ExecutionExplanation;
  costPrediction?: any;
  throttleParams?: {
    delayMs: number;
    rateLimit: number;
  };
}

export interface InterceptorOptions {
  mode: string;
  tenantId: string;
  failOpen: boolean;
  maxLatencyMs: number;
  localCacheSize: number;
}

/**
 * ExecutionInterceptor
 * Main execution control entry point
 * @deprecated Use ExecutionOS from src/os/ instead
 */
export class ExecutionInterceptor extends EventEmitter {
  private metrics = {
    totalRequests: 0,
    blockedRequests: 0,
    avgLatencyMs: 0,
  };

  private options: InterceptorOptions;
  private localCache: Map<string, ExecutionDecisionResult>;
  private isHealthy = true;

  constructor(options: Partial<InterceptorOptions> = {}) {
    super();
    this.options = {
      mode: 'local',
      tenantId: 'default',
      failOpen: true,
      maxLatencyMs: 10,
      localCacheSize: 10000,
      ...options,
    };
    this.localCache = new Map();
  }

  /**
   * Intercept execution request
   * Main entry point - must complete in <10ms
   */
  async intercept(request: ExecutionRequest): Promise<ExecutionDecisionResult> {
    const startTime = performance.now();

    try {
      // Fast path: local cache lookup (<1ms)
      const cached = this.checkLocalCache(request);
      if (cached) {
        const latency = performance.now() - startTime;
        return { ...cached, latencyMs: latency };
      }

      // Parallel execution of checks (async but bounded)
      const [policyResult, graphResult, costResult] = await Promise.all([
        this.evaluatePolicy(request),
        this.analyzeBehaviorGraph(request),
        this.predictCostToGo(request),
      ]);

      // Synthesize decision
      const decision = this.synthesizeDecision(policyResult, graphResult, costResult);

      // Build explanation
      const explanation = this.buildExplanation(request, policyResult, graphResult, costResult);

      const latency = performance.now() - startTime;

      // Update metrics
      this.updateMetrics(latency, decision.decision);

      // Cache result
      this.cacheResult(request, { ...decision, explanation, latencyMs: latency });

      // Emit event for async processing
      this.emit('execution:decided', {
        request,
        decision,
        latency,
        timestamp: Date.now(),
      });

      return {
        ...decision,
        explanation,
        latencyMs: latency,
      };
    } catch (error) {
      // Fail-open: log error but allow execution
      if (this.options.failOpen) {
        this.emit('execution:error', { request, error, timestamp: Date.now() });

        return {
          decision: 'allow',
          reason: 'Fail-open mode: interceptor error',
          confidence: 0,
          latencyMs: performance.now() - startTime,
          policyRulesTriggered: [],
          explanation: {
            summary: 'Execution allowed due to interceptor error (fail-open mode)',
            details: ['Interceptor encountered an error', 'Request allowed to prevent disruption'],
            policyRules: [],
          },
        };
      }

      // Fail-closed: block execution
      return {
        decision: 'block',
        reason: 'Interceptor error',
        confidence: 1,
        latencyMs: performance.now() - startTime,
        policyRulesTriggered: ['error-safety'],
        explanation: {
          summary: 'Execution blocked due to interceptor error',
          details: ['Interceptor encountered an error', 'Request blocked for safety'],
          policyRules: [],
        },
      };
    }
  }

  /**
   * Evaluate policy rules (hierarchical)
   * Tenant → Team → User → Workflow
   */
  private async evaluatePolicy(request: ExecutionRequest): Promise<any> {
    // Stub for policy engine integration
    // In production: call policy engine with context
    return {
      allowed: true,
      rulesChecked: [],
      violations: [],
    };
  }

  /**
   * Analyze agent behavior graph
   * Detect loops, redundancy, runaway branching
   */
  private async analyzeBehaviorGraph(request: ExecutionRequest): Promise<any> {
    // Stub for behavior graph engine
    // In production: query graph state for this session
    return {
      workflowStep: 1,
      loopDetected: false,
      redundancyScore: 0,
      branchDepth: 0,
    };
  }

  /**
   * Predict cost-to-go
   * Estimate remaining tokens, tool calls, worst-case
   */
  private async predictCostToGo(request: ExecutionRequest): Promise<any> {
    // Stub for cost prediction engine
    return {
      currentCost: request.estimatedCost,
      predictedTotal: request.estimatedCost * 2,
      worstCase: request.estimatedCost * 5,
      confidence: 0.7,
    };
  }

  /**
   * Synthesize final decision from all analyses
   */
  private synthesizeDecision(
    policyResult: any,
    graphResult: any,
    costResult: any
  ): Omit<ExecutionDecisionResult, 'explanation' | 'latencyMs'> {
    // Priority: Block > Throttle > Allow

    // Check for critical violations
    if (policyResult.violations?.some((v: any) => v.severity === 'critical')) {
      return {
        decision: 'block',
        reason: 'Critical policy violation',
        confidence: 0.95,
        policyRulesTriggered: policyResult.violations.map((v: any) => v.rule),
        costPrediction: costResult,
      };
    }

    // Check for loops or runaway patterns
    if (graphResult.loopDetected || graphResult.redundancyScore > 0.8) {
      return {
        decision: 'block',
        reason: 'Behavioral anomaly detected',
        confidence: 0.9,
        policyRulesTriggered: ['behavioral-check'],
        costPrediction: costResult,
      };
    }

    // Check for cost warnings
    if (costResult.worstCase > 10) {
      // $10 threshold
      return {
        decision: 'throttle',
        reason: 'High cost prediction',
        confidence: 0.8,
        policyRulesTriggered: ['cost-threshold'],
        costPrediction: costResult,
        throttleParams: {
          delayMs: 1000,
          rateLimit: 10,
        },
      };
    }

    // Default: allow
    return {
      decision: 'allow',
      reason: 'All checks passed',
      confidence: 0.95,
      policyRulesTriggered: [],
      costPrediction: costResult,
    };
  }

  /**
   * Build human-readable explanation
   */
  private buildExplanation(
    request: ExecutionRequest,
    policyResult: any,
    graphResult: any,
    costResult: any
  ): ExecutionExplanation {
    return {
      summary: 'Execution decision explanation',
      details: [
        `Request type: ${request.type}`,
        `Provider: ${request.provider}`,
        `Estimated cost: $${request.estimatedCost.toFixed(4)}`,
      ],
      policyRules: policyResult.rulesChecked || [],
      behaviorGraph: {
        workflowStep: graphResult.workflowStep,
        loopDetected: graphResult.loopDetected,
        redundancyScore: graphResult.redundancyScore,
      },
      costBreakdown: {
        currentCost: costResult.currentCost,
        predictedRemaining: costResult.predictedTotal - costResult.currentCost,
        totalBudget: 50, // Default budget
      },
    };
  }

  /**
   * Check local cache for quick decisions
   */
  private checkLocalCache(request: ExecutionRequest): ExecutionDecisionResult | null {
    const key = this.cacheKey(request);
    return this.localCache.get(key) || null;
  }

  /**
   * Cache decision result
   */
  private cacheResult(request: ExecutionRequest, result: ExecutionDecisionResult): void {
    const key = this.cacheKey(request);
    this.localCache.set(key, result);
  }

  /**
   * Generate cache key for request
   */
  private cacheKey(request: ExecutionRequest): string {
    return `${request.context.tenantId}:${request.context.sessionId}:${request.id}`;
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(latencyMs: number, decision: ExecutionDecision): void {
    this.metrics.totalRequests++;
    if (decision === 'block') {
      this.metrics.blockedRequests++;
    }

    // Simple moving average
    this.metrics.avgLatencyMs =
      (this.metrics.avgLatencyMs * (this.metrics.totalRequests - 1) + latencyMs) /
      this.metrics.totalRequests;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Health check
   */
  health(): { healthy: boolean; latencyMs: number } {
    return {
      healthy: this.isHealthy && this.metrics.avgLatencyMs < this.options.maxLatencyMs,
      latencyMs: this.metrics.avgLatencyMs,
    };
  }
}

// Export singleton for global use
export const executionInterceptor = new ExecutionInterceptor({
  mode: 'local',
  tenantId: 'default',
  failOpen: true,
  maxLatencyMs: 10,
  localCacheSize: 10000,
});
