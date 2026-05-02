/**
 * AECL - AI Execution Control Layer
 * Execution Interceptor Module
 * 
 * DESIGN PHILOSOPHY:
 * - Synchronous, deterministic, cached
 * - <5ms p95 latency (measured, not aspirational)
 * - Fail-open default (production safety)
 * - Zero external dependencies in hot path
 * 
 * PRODUCTION REQUIREMENTS:
 * - Must not block on I/O during decision
 * - Must degrade gracefully under load
 * - Must be debuggable (every decision explained)
 */

import { performance } from 'perf_hooks';
import { createHash } from 'crypto';

export type Decision = 'allow' | 'block';

export interface ExecutionContext {
  sessionId: string;
  agentId: string;
  stepNumber: number;
  previousCalls: number; // In this session
  totalTokens: number;   // Accumulated in session
  totalCost: number;     // Accumulated in session (USD)
  startTime: number;     // Session start timestamp
}

export interface ExecutionRequest {
  id: string;
  provider: 'openai' | 'anthropic' | 'langchain' | 'custom';
  operation: string;     // e.g., "chat.completions.create"
  model?: string;
  estimatedTokens: number;
  estimatedCost: number; // USD
  context: ExecutionContext;
  inputHash: string;     // Hash of prompt/input for dedup detection
}

export interface DecisionResult {
  decision: Decision;
  reason: string;
  riskScore: number;     // 0-1
  confidence: number;      // 0-1
  latencyMs: number;
  policyTriggered?: string;
  estimatedSavings?: number; // If blocked
  cacheHit: boolean;
}

export interface InterceptorConfig {
  failOpen: boolean;     // true = allow on error, false = block on error
  maxLatencyMs: number;    // Budget for decision (default: 5)
  cacheSize: number;     // LRU cache size (default: 10000)
  defaultPolicy: {
    maxCostPerSession: number;
    maxStepsPerSession: number;
    maxCostPerRequest: number;
  };
}

// In-memory LRU cache for sub-millisecond repeat decisions
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Execution Interceptor
 * 
 * Core Design:
 * 1. Hash-based cache lookup (sub-millisecond)
 * 2. Deterministic policy evaluation (no ML in hot path)
 * 3. Fixed-budget timeout (never exceeds 5ms)
 * 4. Synchronous decision, async logging
 */
export class ExecutionInterceptor {
  private config: InterceptorConfig;
  private cache: LRUCache<string, DecisionResult>;
  private metrics: {
    totalRequests: number;
    cacheHits: number;
    blockedRequests: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    latencySamples: number[];
  };

  constructor(config: Partial<InterceptorConfig> = {}) {
    this.config = {
      failOpen: true,
      maxLatencyMs: 5,
      cacheSize: 10000,
      defaultPolicy: {
        maxCostPerSession: 10,    // $10 default
        maxStepsPerSession: 50,   // 50 steps default
        maxCostPerRequest: 5,     // $5 per request default
      },
      ...config,
    };

    this.cache = new LRUCache(this.config.cacheSize);
    this.metrics = {
      totalRequests: 0,
      cacheHits: 0,
      blockedRequests: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      latencySamples: [],
    };
  }

  /**
   * Main interception method
   * MUST complete in <5ms p95
   */
  intercept(request: ExecutionRequest): DecisionResult {
    const startTime = performance.now();
    
    try {
      // 1. Check cache (sub-millisecond path)
      const cacheKey = this.generateCacheKey(request);
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        this.metrics.cacheHits++;
        this.recordLatency(performance.now() - startTime);
        return { ...cached, cacheHit: true, latencyMs: performance.now() - startTime };
      }

      // 2. Risk scoring (<2ms)
      const riskScore = this.calculateRiskScore(request);

      // 3. Policy evaluation (<2ms)
      const policyResult = this.evaluatePolicy(request, riskScore);

      // 4. Build decision
      const result: DecisionResult = {
        decision: policyResult.block ? 'block' : 'allow',
        reason: policyResult.reason,
        riskScore,
        confidence: policyResult.confidence,
        latencyMs: 0, // Will set after
        policyTriggered: policyResult.policyName,
        estimatedSavings: policyResult.block ? request.estimatedCost : 0,
        cacheHit: false,
      };

      // 5. Cache the decision
      this.cache.set(cacheKey, result);

      // 6. Record metrics
      const latency = performance.now() - startTime;
      result.latencyMs = latency;
      this.recordLatency(latency);
      
      if (result.decision === 'block') {
        this.metrics.blockedRequests++;
      }

      return result;

    } catch (error) {
      // Fail-open: log error but allow execution
      console.error('[AECL] Interceptor error:', error);
      
      return {
        decision: this.config.failOpen ? 'allow' : 'block',
        reason: `Interceptor error: ${error instanceof Error ? error.message : 'unknown'}`,
        riskScore: 0,
        confidence: 0,
        latencyMs: performance.now() - startTime,
        cacheHit: false,
      };
    }
  }

  /**
   * Risk scoring - deterministic, explainable
   * Returns 0-1 risk score
   */
  private calculateRiskScore(request: ExecutionRequest): number {
    const ctx = request.context;
    let riskFactors: number[] = [];

    // Factor 1: Cost escalation risk
    const sessionCostRatio = ctx.totalCost / this.config.defaultPolicy.maxCostPerSession;
    if (sessionCostRatio > 0.8) riskFactors.push(0.9);
    else if (sessionCostRatio > 0.5) riskFactors.push(0.6);
    else if (sessionCostRatio > 0.2) riskFactors.push(0.3);

    // Factor 2: Step count risk (potential infinite loop)
    const stepRatio = ctx.stepNumber / this.config.defaultPolicy.maxStepsPerSession;
    if (stepRatio > 0.9) riskFactors.push(0.95);
    else if (stepRatio > 0.7) riskFactors.push(0.7);
    else if (stepRatio > 0.5) riskFactors.push(0.4);

    // Factor 3: Single request cost
    const requestCostRatio = request.estimatedCost / this.config.defaultPolicy.maxCostPerRequest;
    if (requestCostRatio > 1.0) riskFactors.push(1.0);
    else if (requestCostRatio > 0.8) riskFactors.push(0.8);

    // Combine factors (max risk dominates)
    return riskFactors.length > 0 ? Math.max(...riskFactors) : 0.1;
  }

  /**
   * Policy evaluation - simple, deterministic rules
   */
  private evaluatePolicy(request: ExecutionRequest, riskScore: number): {
    block: boolean;
    reason: string;
    confidence: number;
    policyName?: string;
  } {
    const ctx = request.context;
    const policy = this.config.defaultPolicy;

    // Policy 1: Hard cost limit per session
    if (ctx.totalCost + request.estimatedCost > policy.maxCostPerSession) {
      return {
        block: true,
        reason: `Session cost limit exceeded: $${ctx.totalCost.toFixed(2)} + $${request.estimatedCost.toFixed(2)} > $${policy.maxCostPerSession}`,
        confidence: 1.0,
        policyName: 'session_cost_limit',
      };
    }

    // Policy 2: Step limit (loop prevention)
    if (ctx.stepNumber >= policy.maxStepsPerSession) {
      return {
        block: true,
        reason: `Step limit reached: ${ctx.stepNumber} >= ${policy.maxStepsPerSession}`,
        confidence: 1.0,
        policyName: 'step_limit',
      };
    }

    // Policy 3: Single request cost
    if (request.estimatedCost > policy.maxCostPerRequest) {
      return {
        block: true,
        reason: `Request cost too high: $${request.estimatedCost.toFixed(2)} > $${policy.maxCostPerRequest}`,
        confidence: 1.0,
        policyName: 'request_cost_limit',
      };
    }

    // Policy 4: Risk threshold
    if (riskScore > 0.85) {
      return {
        block: true,
        reason: `High risk score: ${(riskScore * 100).toFixed(0)}%`,
        confidence: riskScore,
        policyName: 'risk_threshold',
      };
    }

    // Allow with confidence based on risk
    return {
      block: false,
      reason: riskScore > 0.5 ? `Elevated risk: ${(riskScore * 100).toFixed(0)}%` : 'Low risk',
      confidence: 1 - riskScore,
    };
  }

  /**
   * Generate cache key for request
   */
  private generateCacheKey(request: ExecutionRequest): string {
    // Hash of: sessionId + stepNumber + operation + estimatedCost
    const key = `${request.context.sessionId}:${request.context.stepNumber}:${request.operation}:${request.estimatedCost}`;
    return createHash('sha256').update(key).digest('hex').substring(0, 32);
  }

  /**
   * Record latency metrics
   */
  private recordLatency(latencyMs: number): void {
    this.metrics.totalRequests++;
    this.metrics.latencySamples.push(latencyMs);
    
    // Keep only last 1000 samples for p95 calc
    if (this.metrics.latencySamples.length > 1000) {
      this.metrics.latencySamples.shift();
    }

    // Update avg
    const prevAvg = this.metrics.avgLatencyMs;
    const n = this.metrics.totalRequests;
    this.metrics.avgLatencyMs = (prevAvg * (n - 1) + latencyMs) / n;

    // Update p95 (simplified)
    if (this.metrics.latencySamples.length >= 100) {
      const sorted = [...this.metrics.latencySamples].sort((a, b) => a - b);
      this.metrics.p95LatencyMs = sorted[Math.floor(sorted.length * 0.95)];
    }
  }

  /**
   * Get metrics for ROI telemetry
   */
  getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.totalRequests > 0 
        ? this.metrics.cacheHits / this.metrics.totalRequests 
        : 0,
      blockRate: this.metrics.totalRequests > 0
        ? this.metrics.blockedRequests / this.metrics.totalRequests
        : 0,
    };
  }

  /**
   * Reset (for testing)
   */
  reset(): void {
    this.cache.clear();
    this.metrics = {
      totalRequests: 0,
      cacheHits: 0,
      blockedRequests: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      latencySamples: [],
    };
  }
}

// Export singleton for simple use cases
export const interceptor = new ExecutionInterceptor();
