/**
 * AERL - Failure Prediction System
 * 
 * Predicts next-step failure BEFORE execution using:
 * - Historical execution patterns
 * - Current graph state
 * - Reliability scores
 * 
 * OUTPUTS:
 * - Failure risk score (0-1)
 * - Recommended action adjustment:
 *   - allow
 *   - block  
 *   - retry strategy
 *   - tool substitution
 *   - step skip
 * 
 * REQUIREMENTS:
 * - Predicts BEFORE execution
 * - Uses pattern matching, not ML
 * - <1ms prediction time
 * - Explainable recommendations
 */

import { ExecutionGraph, GraphAnalysis } from './ExecutionGraph';
import { ReliabilityAssessment } from './ReliabilityEngine';

export type FailureAction = 
  | 'allow'
  | 'block'
  | 'retry_immediate'
  | 'retry_backoff'
  | 'substitute_tool'
  | 'skip_step';

export interface FailurePrediction {
  riskScore: number;           // 0-1 probability of failure
  confidence: number;          // 0-1
  recommendedAction: FailureAction;
  alternativeTool?: string;
  reason: string;
  warningSignals: string[];
}

export interface FailurePattern {
  name: string;
  condition: (graph: GraphAnalysis, reliability: ReliabilityAssessment) => boolean;
  action: FailureAction;
  alternativeTool?: string;
  reason: string;
}

export class FailurePredictionSystem {
  private patterns: FailurePattern[];
  private failureHistory: Map<string, { failureType: string; timestamp: number }[]>;

  constructor() {
    this.failureHistory = new Map();
    this.patterns = this.initializePatterns();
  }

  private initializePatterns(): FailurePattern[] {
    return [
      // Pattern 1: Retry storm
      {
        name: 'retry_storm',
        condition: (graph) => graph.retryStorm,
        action: 'block',
        reason: 'Retry storm detected - multiple rapid retries indicate systemic issue',
      },
      // Pattern 2: Loop detected
      {
        name: 'infinite_loop',
        condition: (graph) => graph.hasLoop,
        action: 'block',
        reason: 'Execution loop detected - workflow cycling without progress',
      },
      // Pattern 3: Stuck state
      {
        name: 'stuck_state',
        condition: (graph) => graph.stuckSteps > 5,
        action: 'retry_backoff',
        reason: 'Stuck state - many steps without success, attempting backoff retry',
      },
      // Pattern 4: Redundant branches
      {
        name: 'redundant_execution',
        condition: (graph) => graph.redundantBranches.length > 0,
        action: 'skip_step',
        reason: 'Redundant execution detected - similar work already performed',
      },
      // Pattern 5: High reliability failure probability
      {
        name: 'high_failure_risk',
        condition: (_, reliability) => reliability.factors.failureProbability > 0.7,
        action: 'retry_backoff',
        reason: 'High failure probability detected, suggesting retry with backoff',
      },
      // Pattern 6: Cost explosion imminent
      {
        name: 'cost_explosion',
        condition: (_, reliability) => reliability.factors.costExplosionProbability > 0.8,
        action: 'substitute_tool',
        alternativeTool: 'cheaper_model',
        reason: 'Cost explosion risk - switching to cheaper alternative',
      },
      // Pattern 7: Goal drift
      {
        name: 'goal_drift',
        condition: (_, reliability) => reliability.factors.goalDriftProbability > 0.6,
        action: 'block',
        reason: 'Goal drift detected - agent diverging from objective',
      },
      // Pattern 8: Deep graph (complexity risk)
      {
        name: 'complexity_risk',
        condition: (graph) => graph.depth > 50,
        action: 'substitute_tool',
        alternativeTool: 'simplified_model',
        reason: 'Workflow complexity high, suggesting simplified approach',
      },
    ];
  }

  /**
   * Predict failure for next execution step
   */
  predict(
    workflowId: string,
    graph: GraphAnalysis,
    reliability: ReliabilityAssessment,
    nextOperation: string
  ): FailurePrediction {
    const warningSignals: string[] = [];
    let highestRiskScore = 0;
    let bestMatch: FailurePattern | null = null;

    // Check all patterns
    for (const pattern of this.patterns) {
      if (pattern.condition(graph, reliability)) {
        const riskScore = this.calculatePatternRisk(pattern, graph, reliability);
        warningSignals.push(`${pattern.name}: ${pattern.reason}`);

        if (riskScore > highestRiskScore) {
          highestRiskScore = riskScore;
          bestMatch = pattern;
        }
      }
    }

    // Base risk from reliability
    const baseRisk = 1 - reliability.score;
    const finalRisk = Math.max(baseRisk, highestRiskScore);

    // Record for learning
    this.recordPrediction(workflowId, bestMatch?.name || 'none', finalRisk);

    return {
      riskScore: finalRisk,
      confidence: reliability.confidence,
      recommendedAction: bestMatch?.action || 'allow',
      alternativeTool: bestMatch?.alternativeTool,
      reason: bestMatch?.reason || 'No failure patterns detected',
      warningSignals,
    };
  }

  private calculatePatternRisk(
    pattern: FailurePattern,
    graph: GraphAnalysis,
    reliability: ReliabilityAssessment
  ): number {
    switch (pattern.name) {
      case 'retry_storm':
        return 0.9;
      case 'infinite_loop':
        return 0.95;
      case 'stuck_state':
        return 0.6 + (graph.stuckSteps * 0.05);
      case 'redundant_execution':
        return 0.5;
      case 'high_failure_risk':
        return reliability.factors.failureProbability;
      case 'cost_explosion':
        return reliability.factors.costExplosionProbability;
      case 'goal_drift':
        return reliability.factors.goalDriftProbability;
      case 'complexity_risk':
        return Math.min(0.8, graph.depth / 100);
      default:
        return 0.5;
    }
  }

  /**
   * Get suggested retry strategy based on failure history
   */
  getRetryStrategy(workflowId: string, operation: string): {
    strategy: 'immediate' | 'linear_backoff' | 'exponential_backoff' | 'circuit_break';
    maxRetries: number;
    baseDelayMs: number;
  } {
    const history = this.failureHistory.get(workflowId) || [];
    const recentFailures = history.slice(-5);

    // If many recent failures, use circuit breaker
    if (recentFailures.length >= 3) {
      return {
        strategy: 'circuit_break',
        maxRetries: 0,
        baseDelayMs: 0,
      };
    }

    // If intermittent failures, use exponential backoff
    if (recentFailures.length >= 2) {
      return {
        strategy: 'exponential_backoff',
        maxRetries: 3,
        baseDelayMs: 1000,
      };
    }

    // Default: linear backoff
    return {
      strategy: 'linear_backoff',
      maxRetries: 2,
      baseDelayMs: 500,
    };
  }

  private recordPrediction(workflowId: string, patternName: string, riskScore: number): void {
    const existing = this.failureHistory.get(workflowId) || [];
    existing.push({
      failureType: patternName,
      timestamp: Date.now(),
    });

    // Keep last 20
    if (existing.length > 20) {
      existing.shift();
    }

    this.failureHistory.set(workflowId, existing);
  }

  /**
   * Record actual failure for pattern learning
   */
  recordFailure(workflowId: string, failureType: string): void {
    this.recordPrediction(workflowId, failureType, 1.0);
  }

  /**
   * Clear history for workflow
   */
  clearWorkflow(workflowId: string): void {
    this.failureHistory.delete(workflowId);
  }
}

export const failurePredictor = new FailurePredictionSystem();
