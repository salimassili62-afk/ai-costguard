/**
 * productionSafety.ts - Production Safety Layer
 * 
 * Guarantees:
 * - System never crashes execution flow
 * - Always returns deterministic decision
 * - Fallback rules if engine fails
 * - Safe mode for critical production environments
 * 
 * Core principle: If anything goes wrong, fail safely
 */

import { DetectionResult } from '../core/DetectionEngine';
import { AuditEntry, auditLedger } from './auditLedger';

export interface SafetyConfig {
  // Fail-safe behavior
  defaultDecision: 'allow' | 'block';
  maxDecisionTimeMs: number;
  enableCircuitBreaker: boolean;
  circuitBreakerThreshold: number;
  
  // Fallback costs (when calculation fails)
  defaultCostEstimate: number;
  maxAcceptableCost: number;
  
  // Safety limits
  maxRequestsPerSecond: number;
  globalRateLimit: number;
}

export interface SafeModeResult {
  safe: boolean;
  decision: 'allow' | 'block' | 'throttle';
  reason: string;
  fallback: boolean;
  originalError?: string;
  safetyTriggered: string[];
}

export interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  open: boolean;
  halfOpen: boolean;
}

/**
 * ProductionSafety - Bulletproof execution guarantees
 * 
 * Enterprise guarantees:
 * 1. Never crash customer execution flow
 * 2. Always return a decision (even on engine failure)
 * 3. Automatic fallback to safe defaults
 * 4. Circuit breaker prevents cascade failures
 */
export class ProductionSafety {
  private config: SafetyConfig;
  private circuitBreaker: CircuitBreakerState;
  private requestTimestamps: number[] = [];

  constructor(config?: Partial<SafetyConfig>) {
    this.config = {
      defaultDecision: 'allow',
      maxDecisionTimeMs: 100,
      enableCircuitBreaker: true,
      circuitBreakerThreshold: 5,
      defaultCostEstimate: 0.01,
      maxAcceptableCost: 1.0,
      maxRequestsPerSecond: 1000,
      globalRateLimit: 10000,
      ...config,
    };

    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: 0,
      open: false,
      halfOpen: false,
    };
  }

  /**
   * Wrap any detection function with safety guarantees
   * This is the primary API for production use
   */
  async safeDetect<T extends DetectionResult>(
    detectFn: () => Promise<T>,
    context: {
      requestId: string;
      sessionId: string;
      input: string;
      model: string;
      source: 'sdk' | 'proxy' | 'cli' | 'middleware';
    }
  ): Promise<T | SafeModeFallbackResult> {
    const safetyTriggered: string[] = [];

    try {
      // Check 1: Circuit breaker
      if (this.config.enableCircuitBreaker && this.isCircuitBreakerOpen()) {
        safetyTriggered.push('circuit_breaker');
        return this.createFallbackResult(context, 'Circuit breaker open - too many failures', safetyTriggered);
      }

      // Check 2: Rate limiting
      if (this.isRateLimited()) {
        safetyTriggered.push('rate_limit');
        return this.createFallbackResult(context, 'Rate limit exceeded', safetyTriggered);
      }

      // Check 3: Timeout wrapper
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Decision timeout')), this.config.maxDecisionTimeMs);
      });

      const result = await Promise.race([detectFn(), timeoutPromise]);

      // Success - reset circuit breaker
      this.onSuccess();
      this.recordRequest();

      // Audit log the successful decision
      this.logDecision(context, result as DetectionResult, false, undefined);

      return result;

    } catch (error) {
      // Failure - handle safely
      this.onFailure();
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      safetyTriggered.push('engine_failure');

      // Always log the failure
      this.logDecision(context, null, true, errorMessage);

      // Return safe fallback
      return this.createFallbackResult(context, errorMessage, safetyTriggered);
    }
  }

  /**
   * Synchronous version for environments that can't use async
   */
  safeDetectSync<T extends DetectionResult>(
    detectFn: () => T,
    context: {
      requestId: string;
      sessionId: string;
      input: string;
      model: string;
      source: 'sdk' | 'proxy' | 'cli' | 'middleware';
    }
  ): T | SafeModeFallbackResult {
    const safetyTriggered: string[] = [];

    try {
      // Check circuit breaker
      if (this.config.enableCircuitBreaker && this.isCircuitBreakerOpen()) {
        safetyTriggered.push('circuit_breaker');
        return this.createFallbackResult(context, 'Circuit breaker open', safetyTriggered);
      }

      // Check rate limit
      if (this.isRateLimited()) {
        safetyTriggered.push('rate_limit');
        return this.createFallbackResult(context, 'Rate limit exceeded', safetyTriggered);
      }

      // Execute with timeout protection via synchronous check
      const startTime = Date.now();
      const result = detectFn();
      const elapsed = Date.now() - startTime;

      // If it took too long, still use result but log warning
      if (elapsed > this.config.maxDecisionTimeMs) {
        safetyTriggered.push('slow_decision');
      }

      this.onSuccess();
      this.recordRequest();
      this.logDecision(context, result, false, undefined);

      return result;

    } catch (error) {
      this.onFailure();
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      safetyTriggered.push('engine_failure');

      this.logDecision(context, null, true, errorMessage);

      return this.createFallbackResult(context, errorMessage, safetyTriggered);
    }
  }

  /**
   * Get current safety status
   */
  getSafetyStatus(): {
    circuitBreaker: CircuitBreakerState;
    recentRequests: number;
    healthy: boolean;
  } {
    return {
      circuitBreaker: { ...this.circuitBreaker },
      recentRequests: this.requestTimestamps.length,
      healthy: !this.circuitBreaker.open && !this.isRateLimited(),
    };
  }

  /**
   * Manual circuit breaker control
   */
  openCircuitBreaker(): void {
    this.circuitBreaker.open = true;
    this.circuitBreaker.halfOpen = false;
  }

  closeCircuitBreaker(): void {
    this.circuitBreaker.open = false;
    this.circuitBreaker.halfOpen = false;
    this.circuitBreaker.failures = 0;
  }

  /**
   * Update safety configuration
   */
  updateConfig(config: Partial<SafetyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Private methods

  private isCircuitBreakerOpen(): boolean {
    if (!this.circuitBreaker.open) {
      return false;
    }

    // Check if we should try half-open
    const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailureTime;
    const COOLDOWN_MS = 30000; // 30 seconds

    if (timeSinceLastFailure > COOLDOWN_MS) {
      this.circuitBreaker.halfOpen = true;
      this.circuitBreaker.open = false;
      return false;
    }

    return true;
  }

  private isRateLimited(): boolean {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Clean old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneSecondAgo);

    // Check limits
    if (this.requestTimestamps.length >= this.config.maxRequestsPerSecond) {
      return true;
    }

    return false;
  }

  private recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  private onSuccess(): void {
    if (this.circuitBreaker.halfOpen) {
      // If half-open and succeeds, fully close
      this.closeCircuitBreaker();
    }
  }

  private onFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failures >= this.config.circuitBreakerThreshold) {
      this.circuitBreaker.open = true;
      this.circuitBreaker.halfOpen = false;
    }
  }

  private createFallbackResult(
    context: {
      requestId: string;
      sessionId: string;
      input: string;
      model: string;
      source: 'sdk' | 'proxy' | 'cli' | 'middleware';
    },
    reason: string,
    safetyTriggered: string[]
  ): SafeModeFallbackResult {
    const decision = this.config.defaultDecision;

    return {
      decision,
      dangerScore: decision === 'block' ? 100 : 0,
      riskLevel: decision === 'block' ? 'CRITICAL' : 'LOW',
      category: 'safe',
      reason: `Safety fallback: ${reason}`,
      saved: 0,
      wouldHaveLost: this.config.defaultCostEstimate,
      metadata: {
        promptHash: this.hashInput(context.input),
        duplicateCount: 0,
        loopCount: 0,
        estimatedCost: this.config.defaultCostEstimate,
        timingsMs: {
          total: 0,
          loop: 0,
          duplicate: 0,
          cost: 0,
          budget: 0,
          context: 0,
          fuzzy: 0,
        },
      },
      fallback: true,
      safetyTriggered,
      originalError: reason,
    };
  }

  private logDecision(
    context: {
      requestId: string;
      sessionId: string;
      input: string;
      model: string;
      source: 'sdk' | 'proxy' | 'cli' | 'middleware';
    },
    result: DetectionResult | null,
    fallback: boolean,
    error?: string
  ): void {
    try {
      auditLedger.recordDecision({
        requestId: context.requestId,
        sessionId: context.sessionId,
        input: context.input,
        policyVersion: fallback ? 'safety_fallback' : 'active',
        policySnapshot: { fallback, error },
        decision: (result?.decision as 'allow' | 'block' | 'throttle') || this.config.defaultDecision,
        decisionReason: result?.reason || error || 'Safety fallback',
        decisionCategory: 'safe',
        estimatedCost: result?.metadata?.estimatedCost || this.config.defaultCostEstimate,
        actualCost: undefined,
        riskScore: result?.dangerScore || 0,
        riskLevel: result?.riskLevel || 'LOW',
        dangerScore: result?.dangerScore || 0,
        model: context.model,
        source: context.source,
        executionTrace: {
          detectionSteps: [],
          policyEvaluations: [],
          finalCalculation: { fallback },
        },
      });
    } catch (e) {
      // If audit logging fails, we still don't crash
      console.error('Failed to log safety decision:', e);
    }
  }

  private hashInput(input: string): string {
    return require('crypto').createHash('sha256').update(input).digest('hex');
  }
}

// Extended result type including fallback flag
export interface SafeModeFallbackResult extends DetectionResult {
  fallback: boolean;
  safetyTriggered: string[];
  originalError?: string;
}

// Singleton instance with production defaults
export const productionSafety = new ProductionSafety({
  defaultDecision: 'allow', // Fail open - don't block execution unless certain
  maxDecisionTimeMs: 100,
  enableCircuitBreaker: true,
  circuitBreakerThreshold: 5,
});

// Factory for custom configurations
export function createProductionSafety(config?: Partial<SafetyConfig>): ProductionSafety {
  return new ProductionSafety(config);
}

// Convenience functions
export function safeDetect<T extends DetectionResult>(
  detectFn: () => Promise<T>,
  context: Parameters<typeof productionSafety.safeDetect>[1]
): Promise<T | SafeModeFallbackResult> {
  return productionSafety.safeDetect(detectFn, context);
}

export function safeDetectSync<T extends DetectionResult>(
  detectFn: () => T,
  context: Parameters<typeof productionSafety.safeDetectSync>[1]
): T | SafeModeFallbackResult {
  return productionSafety.safeDetectSync(detectFn, context);
}
