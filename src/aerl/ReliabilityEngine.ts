/**
 * AERL - Reliability Scoring Engine
 * 
 * Computes probability (0-1) for:
 * - Failure probability
 * - Cost explosion probability
 * - Redundant execution probability
 * - Goal drift probability
 * 
 * REQUIREMENTS:
 * - Deterministic (same input = same score)
 * - Explainable (every factor documented)
 * - <1ms execution time
 * - No ML in hot path
 */

export interface ReliabilityFactors {
  failureProbability: number;      // 0-1
  costExplosionProbability: number;  // 0-1
  redundancyProbability: number;   // 0-1
  goalDriftProbability: number;      // 0-1
  composite: number;                 // Weighted combination
}

export interface ReliabilityContext {
  sessionId: string;
  workflowId: string;
  stepNumber: number;
  recentResults: ('success' | 'failure' | 'partial')[];
  tokenVelocity: number;           // Tokens per minute
  costVelocity: number;              // USD per minute
  goal?: string;                   // Hashed current goal
  previousGoals?: string[];        // Hashed previous goals (for drift detection)
  toolSwitches: number;            // How many times tool changed
}

export interface ReliabilityAssessment {
  score: number;                   // 0-1 composite (higher = more reliable)
  factors: ReliabilityFactors;
  explanation: string[];
  confidence: number;
  recommendations: string[];
}

export class ReliabilityEngine {
  private goalHistory: Map<string, string[]>; // sessionId -> goal sequence

  constructor() {
    this.goalHistory = new Map();
  }

  /**
   * Calculate reliability score
   * Returns 0-1 where 1 = highly reliable
   */
  assess(context: ReliabilityContext): ReliabilityAssessment {
    const factors = this.calculateFactors(context);
    const composite = this.compositeScore(factors);

    // Update goal history for drift detection
    if (context.goal) {
      this.updateGoalHistory(context.sessionId, context.goal);
    }

    return {
      score: composite,
      factors,
      explanation: this.buildExplanation(factors),
      confidence: this.calculateConfidence(context),
      recommendations: this.buildRecommendations(factors),
    };
  }

  private calculateFactors(context: ReliabilityContext): ReliabilityFactors {
    return {
      failureProbability: this.assessFailureProbability(context),
      costExplosionProbability: this.assessCostExplosion(context),
      redundancyProbability: this.assessRedundancy(context),
      goalDriftProbability: this.assessGoalDrift(context),
      composite: 0,
    };
  }

  /**
   * Failure probability based on recent results
   */
  private assessFailureProbability(context: ReliabilityContext): number {
    const recent = context.recentResults;
    if (recent.length === 0) return 0.3; // Unknown = moderate risk

    const failures = recent.filter(r => r === 'failure').length;
    const partials = recent.filter(r => r === 'partial').length;
    const total = recent.length;

    // Weight recent failures more heavily
    const failureRate = failures / total;
    const partialRate = partials / total;

    // Exponential backoff on failure rate
    return Math.min(1, failureRate * 1.5 + partialRate * 0.5 + 0.1);
  }

  /**
   * Cost explosion based on velocity
   */
  private assessCostExplosion(context: ReliabilityContext): number {
    const velocity = context.costVelocity;

    if (velocity > 100) return 0.95;   // >$100/min critical
    if (velocity > 50) return 0.8;     // >$50/min high
    if (velocity > 20) return 0.6;      // >$20/min medium
    if (velocity > 10) return 0.3;      // >$10/min elevated
    if (velocity > 5) return 0.15;    // >$5/min slight

    return 0.05;
  }

  /**
   * Redundancy based on recent patterns
   */
  private assessRedundancy(context: ReliabilityContext): number {
    // Simple heuristic: if we've made >5 calls and all succeeded,
    // might be repeating similar work
    const successes = context.recentResults.filter(r => r === 'success').length;
    const total = context.recentResults.length;

    if (total < 3) return 0.1;

    const successRate = successes / total;
    if (successRate > 0.9 && total > 10) return 0.4; // Too many easy wins
    if (successRate > 0.8 && total > 5) return 0.25;

    return 0.1;
  }

  /**
   * Goal drift detection
   */
  private assessGoalDrift(context: ReliabilityContext): number {
    if (!context.goal || !context.previousGoals) return 0.2;

    const history = this.goalHistory.get(context.sessionId) || [];
    if (history.length < 3) return 0.15;

    // Check if goal is changing frequently
    const recentGoals = history.slice(-5);
    const uniqueGoals = new Set(recentGoals).size;
    const driftRatio = uniqueGoals / recentGoals.length;

    if (driftRatio > 0.8) return 0.7;  // Constantly changing goals
    if (driftRatio > 0.6) return 0.5;  // Moderate drift
    if (driftRatio > 0.4) return 0.3;  // Some drift

    return 0.1;
  }

  private compositeScore(factors: ReliabilityFactors): number {
    // Convert to reliability (1 - risk)
    const failureRisk = factors.failureProbability;
    const costRisk = factors.costExplosionProbability;
    const redundancyRisk = factors.redundancyProbability;
    const driftRisk = factors.goalDriftProbability;

    // Weighted reliability score
    const reliability = 
      (1 - failureRisk) * 0.4 +
      (1 - costRisk) * 0.25 +
      (1 - redundancyRisk) * 0.2 +
      (1 - driftRisk) * 0.15;

    return Math.max(0, Math.min(1, reliability));
  }

  private buildExplanation(factors: ReliabilityFactors): string[] {
    const reasons: string[] = [];

    if (factors.failureProbability > 0.6) {
      reasons.push(`High failure rate: ${(factors.failureProbability * 100).toFixed(0)}%`);
    } else if (factors.failureProbability > 0.3) {
      reasons.push(`Elevated failure risk: ${(factors.failureProbability * 100).toFixed(0)}%`);
    }

    if (factors.costExplosionProbability > 0.7) {
      reasons.push(`Cost velocity critical: ${(factors.costExplosionProbability * 100).toFixed(0)}%`);
    } else if (factors.costExplosionProbability > 0.4) {
      reasons.push(`High cost velocity detected`);
    }

    if (factors.goalDriftProbability > 0.5) {
      reasons.push(`Goal drift detected: ${(factors.goalDriftProbability * 100).toFixed(0)}%`);
    }

    if (factors.redundancyProbability > 0.3) {
      reasons.push(`Potential redundant execution`);
    }

    if (reasons.length === 0) {
      reasons.push('All reliability factors nominal');
    }

    return reasons;
  }

  private calculateConfidence(context: ReliabilityContext): number {
    // More history = higher confidence
    const historySize = context.recentResults.length;
    if (historySize > 20) return 0.95;
    if (historySize > 10) return 0.85;
    if (historySize > 5) return 0.75;
    return 0.6;
  }

  private buildRecommendations(factors: ReliabilityFactors): string[] {
    const recs: string[] = [];

    if (factors.failureProbability > 0.5) {
      recs.push('Consider retry with backoff');
      recs.push('Evaluate alternative tools');
    }

    if (factors.costExplosionProbability > 0.6) {
      recs.push('Implement cost circuit breaker');
      recs.push('Switch to cheaper model');
    }

    if (factors.goalDriftProbability > 0.5) {
      recs.push('Refocus on original goal');
      recs.push('Break into smaller sub-goals');
    }

    if (factors.redundancyProbability > 0.3) {
      recs.push('Check for duplicate work');
      recs.push('Cache recent results');
    }

    return recs;
  }

  private updateGoalHistory(sessionId: string, goal: string): void {
    const existing = this.goalHistory.get(sessionId) || [];
    existing.push(goal);
    if (existing.length > 20) {
      existing.shift();
    }
    this.goalHistory.set(sessionId, existing);
  }

  clearSession(sessionId: string): void {
    this.goalHistory.delete(sessionId);
  }
}

export const reliabilityEngine = new ReliabilityEngine();
