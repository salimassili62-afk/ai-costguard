/**
 * CostPredictionEngine.ts - Cost-to-Go Prediction Engine
 * 
 * Predicts total cost BEFORE execution continues:
 * - Tokens remaining estimation
 * - Downstream tool call prediction  
 * - Worst-case cost scenario
 * - Budget burn rate analysis
 */

import { pricingConfig } from './PricingConfig';

export interface CostPredictionRequest {
  currentCost: number;
  currentTokens: number;
  model: string;
  workflowStep: number;
  maxExpectedSteps: number;
  averageToolCallsPerStep: number;
  averageToolCost: number;
  remainingWorkEstimate?: string; // Description of remaining work
}

export interface CostPrediction {
  currentCost: number;
  predictedTotal: number;
  predictedRange: {
    min: number;
    max: number;
  };
  worstCase: number;
  confidence: number; // 0-1
  breakdown: {
    llmCostRemaining: number;
    toolCostRemaining: number;
    buffer: number;
  };
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
}

export interface BudgetAnalysis {
  budgetLimit: number;
  currentSpend: number;
  remainingBudget: number;
  predictedTotal: number;
  willExceed: boolean;
  projectedExceedAmount: number;
  burnRate: number; // $ per minute
  estimatedTimeToExceed?: number; // minutes
}

export interface BurnRateMetrics {
  startTime: number;
  totalSpend: number;
  requestCount: number;
  averageCostPerRequest: number;
  requestsPerMinute: number;
  spendPerMinute: number;
  trend: 'increasing' | 'stable' | 'decreasing';
}

/**
 * Cost Prediction Engine
 * 
 * Uses multiple prediction strategies:
 * 1. Historical pattern matching
 * 2. Linear projection based on current trajectory
 * 3. Worst-case scenario modeling
 */
export class CostPredictionEngine {
  private historicalPatterns: Map<string, number[]>; // pattern signature -> cost outcomes
  private burnRateHistory: Map<string, BurnRateMetrics>; // sessionId -> metrics

  constructor() {
    this.historicalPatterns = new Map();
    this.burnRateHistory = new Map();
  }

  /**
   * Predict total cost for workflow completion
   */
  predict(request: CostPredictionRequest): CostPrediction {
    const currentStep = request.workflowStep;
    const maxSteps = request.maxExpectedSteps;
    const remainingSteps = Math.max(0, maxSteps - currentStep);

    // Strategy 1: Linear projection
    const costPerStep = currentStep > 0 ? request.currentCost / currentStep : request.currentCost;
    const linearPrediction = request.currentCost + (costPerStep * remainingSteps);

    // Strategy 2: Tool call projection
    const expectedToolCalls = remainingSteps * request.averageToolCallsPerStep;
    const toolCostRemaining = expectedToolCalls * request.averageToolCost;

    // Strategy 3: LLM cost (tokens for remaining steps)
    const avgTokensPerStep = currentStep > 0 ? request.currentTokens / currentStep : 1000;
    const remainingTokens = avgTokensPerStep * remainingSteps;
    const llmCostRemaining = this.estimateLlmCost(remainingTokens, request.model);

    // Combine predictions with buffer
    const basePrediction = linearPrediction + toolCostRemaining;
    const predictedTotal = request.currentCost + llmCostRemaining + toolCostRemaining;
    
    // Worst case: 3x base prediction (unexpected loops, retries, large outputs)
    const worstCase = predictedTotal * 3;

    // Confidence based on data availability
    let confidence = 0.6;
    if (currentStep > 3) confidence = 0.75;
    if (currentStep > 5) confidence = 0.85;

    // Risk level
    const riskLevel = this.calculateRiskLevel(request.currentCost, predictedTotal, worstCase);

    // Recommendations
    const recommendations: string[] = [];
    if (riskLevel === 'critical') {
      recommendations.push('High probability of budget overrun - consider terminating workflow');
    } else if (riskLevel === 'high') {
      recommendations.push('Monitor closely - implement circuit breaker at 80% of budget');
    }
    if (worstCase > predictedTotal * 2) {
      recommendations.push('High variance in prediction - consider throttling to reduce risk');
    }

    return {
      currentCost: request.currentCost,
      predictedTotal: Math.round(predictedTotal * 10000) / 10000,
      predictedRange: {
        min: Math.round(predictedTotal * 0.8 * 10000) / 10000,
        max: Math.round(predictedTotal * 1.5 * 10000) / 10000,
      },
      worstCase: Math.round(worstCase * 10000) / 10000,
      confidence: Math.round(confidence * 100) / 100,
      breakdown: {
        llmCostRemaining: Math.round(llmCostRemaining * 10000) / 10000,
        toolCostRemaining: Math.round(toolCostRemaining * 10000) / 10000,
        buffer: Math.round((predictedTotal - request.currentCost - llmCostRemaining - toolCostRemaining) * 10000) / 10000,
      },
      riskLevel,
      recommendations,
    };
  }

  /**
   * Analyze budget status and projection
   */
  analyzeBudget(
    budgetLimit: number,
    currentSpend: number,
    prediction: CostPrediction,
    sessionId: string
  ): BudgetAnalysis {
    const remainingBudget = budgetLimit - currentSpend;
    const willExceed = prediction.predictedTotal > budgetLimit;
    const projectedExceedAmount = willExceed ? prediction.predictedTotal - budgetLimit : 0;
    
    // Calculate burn rate
    const burnRate = this.calculateBurnRate(sessionId, currentSpend);
    
    // Estimate time to exceed
    let estimatedTimeToExceed: number | undefined;
    if (willExceed && burnRate.spendPerMinute > 0) {
      estimatedTimeToExceed = remainingBudget / burnRate.spendPerMinute;
    }

    return {
      budgetLimit,
      currentSpend,
      remainingBudget: Math.round(remainingBudget * 10000) / 10000,
      predictedTotal: prediction.predictedTotal,
      willExceed,
      projectedExceedAmount: Math.round(projectedExceedAmount * 10000) / 10000,
      burnRate: Math.round(burnRate.spendPerMinute * 10000) / 10000,
      estimatedTimeToExceed: estimatedTimeToExceed ? Math.round(estimatedTimeToExceed * 100) / 100 : undefined,
    };
  }

  /**
   * Record actual cost for pattern learning
   */
  recordActualCost(
    patternSignature: string,
    predictedCost: number,
    actualCost: number
  ): void {
    const outcomes = this.historicalPatterns.get(patternSignature) || [];
    outcomes.push(actualCost);
    
    // Keep only last 100 outcomes
    if (outcomes.length > 100) {
      outcomes.shift();
    }
    
    this.historicalPatterns.set(patternSignature, outcomes);
  }

  /**
   * Get historical accuracy for a pattern
   */
  getHistoricalAccuracy(patternSignature: string): {
    samples: number;
    averageError: number;
    accuracy: number;
  } {
    const outcomes = this.historicalPatterns.get(patternSignature) || [];
    
    if (outcomes.length === 0) {
      return { samples: 0, averageError: 0, accuracy: 0 };
    }

    const averageActual = outcomes.reduce((a, b) => a + b, 0) / outcomes.length;
    const variance = outcomes.reduce((sum, val) => sum + Math.pow(val - averageActual, 2), 0) / outcomes.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Accuracy: inverse of coefficient of variation
    const accuracy = averageActual > 0 ? Math.max(0, 1 - (standardDeviation / averageActual)) : 0;

    return {
      samples: outcomes.length,
      averageError: Math.round(standardDeviation * 10000) / 10000,
      accuracy: Math.round(accuracy * 100) / 100,
    };
  }

  /**
   * Update burn rate metrics for a session
   */
  updateBurnRate(sessionId: string, currentSpend: number): BurnRateMetrics {
    let metrics = this.burnRateHistory.get(sessionId);
    const now = Date.now();

    if (!metrics) {
      metrics = {
        startTime: now,
        totalSpend: currentSpend,
        requestCount: 1,
        averageCostPerRequest: currentSpend,
        requestsPerMinute: 0,
        spendPerMinute: 0,
        trend: 'stable',
      };
    } else {
      const elapsedMinutes = (now - metrics.startTime) / 60000;
      
      metrics.requestCount++;
      metrics.totalSpend = currentSpend;
      metrics.averageCostPerRequest = currentSpend / metrics.requestCount;
      
      if (elapsedMinutes > 0) {
        metrics.requestsPerMinute = metrics.requestCount / elapsedMinutes;
        metrics.spendPerMinute = currentSpend / elapsedMinutes;
      }

      // Determine trend
      const previousSpendPerMinute = metrics.spendPerMinute;
      if (metrics.spendPerMinute > previousSpendPerMinute * 1.2) {
        metrics.trend = 'increasing';
      } else if (metrics.spendPerMinute < previousSpendPerMinute * 0.8) {
        metrics.trend = 'decreasing';
      } else {
        metrics.trend = 'stable';
      }
    }

    this.burnRateHistory.set(sessionId, metrics);
    return metrics;
  }

  /**
   * Get burn rate for a session
   */
  getBurnRate(sessionId: string): BurnRateMetrics | undefined {
    return this.burnRateHistory.get(sessionId);
  }

  /**
   * Calculate risk level based on costs
   */
  private calculateRiskLevel(
    currentCost: number,
    predictedTotal: number,
    worstCase: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    const ratio = predictedTotal / Math.max(currentCost, 0.01);
    const variance = (worstCase - predictedTotal) / Math.max(predictedTotal, 0.01);

    if (predictedTotal > 50 || variance > 5) return 'critical';
    if (predictedTotal > 20 || variance > 3) return 'high';
    if (predictedTotal > 5 || ratio > 5) return 'medium';
    return 'low';
  }

  /**
   * Estimate LLM cost for tokens
   */
  private estimateLlmCost(tokens: number, model: string): number {
    const pricing = pricingConfig.getPricing(model);
    // Assume 70% input, 30% output split
    const inputTokens = Math.floor(tokens * 0.7);
    const outputTokens = Math.floor(tokens * 0.3);
    
    const inputCost = (inputTokens / 1000) * pricing.inputPer1K;
    const outputCost = (outputTokens / 1000) * pricing.outputPer1K;
    
    return inputCost + outputCost;
  }

  /**
   * Calculate burn rate metrics
   */
  private calculateBurnRate(sessionId: string, currentSpend: number): BurnRateMetrics {
    return this.updateBurnRate(sessionId, currentSpend);
  }
}

// Export singleton
export const costPredictionEngine = new CostPredictionEngine();
