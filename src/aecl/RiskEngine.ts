/**
 * AECL - Risk Scoring Engine
 * 
 * Computes probability (0-1) of:
 * - Cost explosion
 * - Infinite loop  
 * - Redundant tool calls
 * 
 * REQUIREMENTS:
 * - Deterministic (same input = same score)
 * - Explainable (every factor documented)
 * - <1ms execution time
 * - No ML models in hot path
 */

export interface RiskFactors {
  costExplosion: number;    // 0-1 probability
  infiniteLoop: number;     // 0-1 probability
  redundancy: number;       // 0-1 probability
  composite: number;        // Combined score
}

export interface RiskContext {
  sessionId: string;
  stepNumber: number;
  recentCalls: string[];    // Hashed call signatures (last 10)
  tokenVelocity: number;      // Tokens per minute
  costVelocity: number;       // USD per minute
  errorRate: number;        // Errors in last 10 calls
}

export interface RiskAssessment {
  score: number;           // 0-1 composite
  factors: RiskFactors;
  explanation: string[];   // Human-readable reasons
  confidence: number;      // 0-1
}

/**
 * Risk Engine
 * 
 * Uses deterministic heuristics, not ML:
 * - Pattern matching for loops
 * - Velocity thresholds for cost explosions
 * - Hash deduplication for redundancy
 */
export class RiskEngine {
  private loopPatterns: Map<string, number>; // sessionId -> pattern strength
  private callHistory: Map<string, string[]>; // sessionId -> recent hashes

  constructor() {
    this.loopPatterns = new Map();
    this.callHistory = new Map();
  }

  /**
   * Calculate risk score
   * Must complete in <1ms
   */
  assess(context: RiskContext): RiskAssessment {
    const startTime = Date.now();

    const factors = this.calculateFactors(context);
    const composite = this.compositeScore(factors);
    const explanation = this.buildExplanation(factors);

    // Update history
    this.updateHistory(context);

    return {
      score: composite,
      factors,
      explanation,
      confidence: this.calculateConfidence(factors),
    };
  }

  private calculateFactors(context: RiskContext): RiskFactors {
    return {
      costExplosion: this.assessCostExplosion(context),
      infiniteLoop: this.assessInfiniteLoop(context),
      redundancy: this.assessRedundancy(context),
      composite: 0, // Set later
    };
  }

  /**
   * Cost explosion detection
   * Based on velocity and acceleration patterns
   */
  private assessCostExplosion(context: RiskContext): number {
    const velocity = context.costVelocity;
    
    // Thresholds (USD per minute)
    if (velocity > 100) return 1.0;  // >$100/min = definite explosion
    if (velocity > 50) return 0.9;   // >$50/min = high risk
    if (velocity > 20) return 0.7;  // >$20/min = medium risk
    if (velocity > 10) return 0.4;  // >$10/min = elevated
    if (velocity > 5) return 0.2;   // >$5/min = slight concern
    
    return 0.05; // Normal
  }

  /**
   * Infinite loop detection
   * Pattern: A→B→A→B or A→A→A
   */
  private assessInfiniteLoop(context: RiskContext): number {
    const recent = context.recentCalls;
    if (recent.length < 4) return 0.05;

    // Check for A-B-A-B pattern
    const last4 = recent.slice(-4);
    if (last4[0] === last4[2] && last4[1] === last4[3]) {
      return 0.95; // Classic oscillation
    }

    // Check for A-A-A repetition
    const last3 = recent.slice(-3);
    if (last3[0] === last3[1] && last3[1] === last3[2]) {
      return 0.9; // Exact repetition
    }

    // Check for increasing repetition frequency
    const last10 = recent.slice(-10);
    const unique = new Set(last10).size;
    const ratio = unique / last10.length;
    
    if (ratio < 0.3) return 0.8;  // 70% repetition
    if (ratio < 0.5) return 0.5;  // 50% repetition
    if (ratio < 0.7) return 0.3;  // 30% repetition

    return 0.1;
  }

  /**
   * Redundancy detection
   * Same call within recent history
   */
  private assessRedundancy(context: RiskContext): number {
    if (context.recentCalls.length < 2) return 0;

    const current = context.recentCalls[context.recentCalls.length - 1];
    const previous = context.recentCalls.slice(0, -1);

    // Check if this exact call happened recently
    const duplicates = previous.filter(h => h === current).length;
    
    if (duplicates >= 2) return 0.9;  // 3rd identical call
    if (duplicates === 1) return 0.6; // 2nd identical call
    if (previous.includes(current)) return 0.3; // Seen before

    return 0.05;
  }

  /**
   * Composite score - max of all factors with weighting
   */
  private compositeScore(factors: RiskFactors): number {
    // Weighted combination
    const weights = {
      costExplosion: 0.4,
      infiniteLoop: 0.35,
      redundancy: 0.25,
    };

    const weighted = 
      factors.costExplosion * weights.costExplosion +
      factors.infiniteLoop * weights.infiniteLoop +
      factors.redundancy * weights.redundancy;

    // Boost if multiple factors are elevated
    const elevatedCount = [
      factors.costExplosion > 0.5,
      factors.infiniteLoop > 0.5,
      factors.redundancy > 0.5,
    ].filter(Boolean).length;

    const boost = elevatedCount >= 2 ? 0.15 : 0;
    
    return Math.min(1.0, weighted + boost);
  }

  /**
   * Build human-readable explanation
   */
  private buildExplanation(factors: RiskFactors): string[] {
    const reasons: string[] = [];

    if (factors.costExplosion > 0.8) {
      reasons.push(`CRITICAL: Cost velocity at $${factors.costExplosion}/min`);
    } else if (factors.costExplosion > 0.5) {
      reasons.push(`WARNING: High cost velocity detected`);
    }

    if (factors.infiniteLoop > 0.8) {
      reasons.push(`CRITICAL: Loop pattern detected in recent calls`);
    } else if (factors.infiniteLoop > 0.5) {
      reasons.push(`WARNING: Repetitive call pattern`);
    }

    if (factors.redundancy > 0.7) {
      reasons.push(`Redundant call: identical to recent execution`);
    }

    if (reasons.length === 0) {
      reasons.push('No significant risk factors detected');
    }

    return reasons;
  }

  /**
   * Confidence based on data quality
   */
  private calculateConfidence(factors: RiskFactors): number {
    // More history = higher confidence
    const hasStrongSignal = 
      factors.costExplosion > 0.8 ||
      factors.infiniteLoop > 0.8 ||
      factors.redundancy > 0.8;

    return hasStrongSignal ? 0.95 : 0.75;
  }

  /**
   * Update call history
   */
  private updateHistory(context: RiskContext): void {
    const existing = this.callHistory.get(context.sessionId) || [];
    const current = context.recentCalls[context.recentCalls.length - 1];
    
    if (current) {
      existing.push(current);
      // Keep only last 20
      if (existing.length > 20) {
        existing.shift();
      }
      this.callHistory.set(context.sessionId, existing);
    }
  }

  /**
   * Clear session data
   */
  clearSession(sessionId: string): void {
    this.callHistory.delete(sessionId);
    this.loopPatterns.delete(sessionId);
  }
}

export const riskEngine = new RiskEngine();
