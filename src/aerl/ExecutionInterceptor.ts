/**
 * AERL - AI Execution Reliability Layer
 * Execution Interceptor Module
 * 
 * PURPOSE:
 * - Synchronous pre-call decision engine
 * - Allow / block / modify decisions
 * - Deterministic + cached
 * - <5ms p95 latency
 * 
 * DESIGN:
 * - In-process only
 * - No external I/O in hot path
 * - LRU cache for sub-millisecond repeat decisions
 * - Fail-open with logging
 */

import { performance } from 'perf_hooks';
import { createHash } from 'crypto';

export type DecisionAction = 'allow' | 'block' | 'modify';

export interface ExecutionContext {
  sessionId: string;
  agentId: string;
  workflowId: string;
  stepNumber: number;
  previousSteps: number;
  totalCost: number;      // USD accumulated
  totalTokens: number;
  successCount: number;     // Successful steps so far
  failureCount: number;     // Failed steps so far
  startTime: number;
  goal?: string;          // Current objective (hashed)
}

export interface ExecutionRequest {
  id: string;
  provider: 'openai' | 'anthropic' | 'langchain' | 'custom';
  operation: string;      // e.g., "chat.completions.create", "tool.search"
  toolName?: string;
  model?: string;
  estimatedTokens: number;
  estimatedCost: number;  // USD
  context: ExecutionContext;
  inputHash: string;      // SHA256 of prompt/input
  dependencies?: string[]; // Step IDs this depends on
}

export interface DecisionResult {
  action: DecisionAction;
  reason: string;
  reliabilityScore: number;   // 0-1 overall
  confidence: number;           // 0-1
  latencyMs: number;
  suggestedModification?: {
    alternativeTool?: string;
    retryStrategy?: 'immediate' | 'backoff' | 'circuit_break';
    parameterAdjustments?: Record<string, number>;
  };
  estimatedSavings?: number;  // Cost saved if blocked
  cacheHit: boolean;
}

export interface InterceptorConfig {
  failOpen: boolean;
  maxLatencyMs: number;
  cacheSize: number;
  defaultPolicy: {
    maxCostPerWorkflow: number;
    maxStepsPerWorkflow: number;
    maxCostPerStep: number;
    minReliabilityScore: number; // Block if below this
  };
}

// LRU Cache for fast-path decisions
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
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next();
      if (!first.done && first.value !== undefined) {
        this.cache.delete(first.value);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

export class ExecutionInterceptor {
  private config: InterceptorConfig;
  private cache: LRUCache<string, DecisionResult>;
  private metrics: {
    totalRequests: number;
    cacheHits: number;
    blockedRequests: number;
    modifiedRequests: number;
    latencySamples: number[];
  };

  constructor(config: Partial<InterceptorConfig> = {}) {
    this.config = {
      failOpen: true,
      maxLatencyMs: 5,
      cacheSize: 10000,
      defaultPolicy: {
        maxCostPerWorkflow: 50,    // $50 default
        maxStepsPerWorkflow: 100,  // 100 steps default
        maxCostPerStep: 10,        // $10 per step
        minReliabilityScore: 0.3,  // Block if reliability < 30%
      },
      ...config,
    };

    this.cache = new LRUCache(this.config.cacheSize);
    this.metrics = {
      totalRequests: 0,
      cacheHits: 0,
      blockedRequests: 0,
      modifiedRequests: 0,
      latencySamples: [],
    };
  }

  /**
   * Main interception - MUST complete in <5ms p95
   */
  intercept(request: ExecutionRequest): DecisionResult {
    const startTime = performance.now();

    try {
      // 1. Cache check (sub-millisecond)
      const cacheKey = this.generateCacheKey(request);
      const cached = this.cache.get(cacheKey);

      if (cached) {
        this.metrics.cacheHits++;
        this.recordLatency(performance.now() - startTime);
        return { ...cached, cacheHit: true, latencyMs: performance.now() - startTime };
      }

      // 2. Evaluate against policy
      const policyResult = this.evaluatePolicy(request);

      // 3. Build decision result
      const result: DecisionResult = {
        action: policyResult.action,
        reason: policyResult.reason,
        reliabilityScore: policyResult.reliabilityScore,
        confidence: policyResult.confidence,
        latencyMs: 0,
        suggestedModification: policyResult.modification,
        estimatedSavings: policyResult.action === 'block' ? request.estimatedCost : undefined,
        cacheHit: false,
      };

      // 4. Cache decision
      this.cache.set(cacheKey, result);

      // 5. Record metrics
      const latency = performance.now() - startTime;
      result.latencyMs = latency;
      this.recordLatency(latency);

      if (result.action === 'block') {
        this.metrics.blockedRequests++;
      } else if (result.action === 'modify') {
        this.metrics.modifiedRequests++;
      }

      return result;

    } catch (error) {
      console.error('[AERL] Interceptor error:', error);

      return {
        action: this.config.failOpen ? 'allow' : 'block',
        reason: `Interceptor error: ${error instanceof Error ? error.message : 'unknown'}`,
        reliabilityScore: this.config.failOpen ? 0.5 : 0,
        confidence: 0,
        latencyMs: performance.now() - startTime,
        cacheHit: false,
      };
    }
  }

  private evaluatePolicy(request: ExecutionRequest): {
    action: DecisionAction;
    reason: string;
    reliabilityScore: number;
    confidence: number;
    modification?: DecisionResult['suggestedModification'];
  } {
    const ctx = request.context;
    const policy = this.config.defaultPolicy;

    // Calculate reliability score
    const reliabilityScore = this.calculateReliabilityScore(request);

    // Policy 1: Hard cost limit
    if (ctx.totalCost + request.estimatedCost > policy.maxCostPerWorkflow) {
      return {
        action: 'block',
        reason: `Workflow cost limit: $${ctx.totalCost.toFixed(2)} + $${request.estimatedCost.toFixed(2)} > $${policy.maxCostPerWorkflow}`,
        reliabilityScore: 0.1,
        confidence: 1.0,
      };
    }

    // Policy 2: Step limit
    if (ctx.stepNumber >= policy.maxStepsPerWorkflow) {
      return {
        action: 'block',
        reason: `Step limit reached: ${ctx.stepNumber} >= ${policy.maxStepsPerWorkflow}`,
        reliabilityScore: 0.05,
        confidence: 1.0,
      };
    }

    // Policy 3: Single step cost
    if (request.estimatedCost > policy.maxCostPerStep) {
      return {
        action: 'modify',
        reason: `Step cost high: $${request.estimatedCost.toFixed(2)} > $${policy.maxCostPerStep}, suggesting cheaper alternative`,
        reliabilityScore: 0.4,
        confidence: 0.8,
        modification: {
          alternativeTool: 'cheaper_model',
          retryStrategy: 'backoff',
        },
      };
    }

    // Policy 4: Low reliability score
    if (reliabilityScore < policy.minReliabilityScore) {
      return {
        action: 'modify',
        reason: `Low reliability score: ${(reliabilityScore * 100).toFixed(0)}% < ${(policy.minReliabilityScore * 100).toFixed(0)}%, suggesting retry strategy`,
        reliabilityScore,
        confidence: 0.85,
        modification: {
          retryStrategy: 'backoff',
          parameterAdjustments: { temperature: 0.3 },
        },
      };
    }

    // Allow
    return {
      action: 'allow',
      reason: reliabilityScore > 0.8 ? 'High reliability' : 'Acceptable risk',
      reliabilityScore,
      confidence: reliabilityScore,
    };
  }

  private calculateReliabilityScore(request: ExecutionRequest): number {
    const ctx = request.context;
    let score = 0.5; // Start neutral

    // Factor 1: Recent failure rate
    const totalSteps = ctx.successCount + ctx.failureCount;
    if (totalSteps > 0) {
      const failureRate = ctx.failureCount / totalSteps;
      score -= failureRate * 0.4; // Up to -0.4 for 100% failure rate
    }

    // Factor 2: Step progression
    const stepRatio = ctx.stepNumber / this.config.defaultPolicy.maxStepsPerWorkflow;
    if (stepRatio > 0.8) score -= 0.2;
    else if (stepRatio > 0.5) score -= 0.1;

    // Factor 3: Cost escalation
    const costRatio = ctx.totalCost / this.config.defaultPolicy.maxCostPerWorkflow;
    if (costRatio > 0.8) score -= 0.2;
    else if (costRatio > 0.5) score -= 0.1;

    // Factor 4: Success streak
    if (ctx.successCount > 5) score += 0.1;
    if (ctx.successCount > 10) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  private generateCacheKey(request: ExecutionRequest): string {
    const key = `${request.context.sessionId}:${request.context.stepNumber}:${request.operation}:${request.estimatedCost}`;
    return createHash('sha256').update(key).digest('hex').substring(0, 32);
  }

  private recordLatency(latencyMs: number): void {
    this.metrics.totalRequests++;
    this.metrics.latencySamples.push(latencyMs);

    if (this.metrics.latencySamples.length > 1000) {
      this.metrics.latencySamples.shift();
    }
  }

  getMetrics() {
    const sorted = [...this.metrics.latencySamples].sort((a, b) => a - b);
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.totalRequests > 0 ? this.metrics.cacheHits / this.metrics.totalRequests : 0,
      blockRate: this.metrics.totalRequests > 0 ? this.metrics.blockedRequests / this.metrics.totalRequests : 0,
      p95LatencyMs: sorted[Math.floor(sorted.length * 0.95)] || 0,
    };
  }

  reset(): void {
    this.cache.clear();
    this.metrics = {
      totalRequests: 0,
      cacheHits: 0,
      blockedRequests: 0,
      modifiedRequests: 0,
      latencySamples: [],
    };
  }
}

export const interceptor = new ExecutionInterceptor();
