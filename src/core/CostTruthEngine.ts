/**
 * CostTruthEngine.ts - Financial Truth System
 *
 * Measures, prevents, and proves financial loss in real-time.
 * Tracks every request to calculate "saved" vs "would have lost" metrics.
 *
 * Core Principle: Every request answers:
 * {
 *   "cost": 0.12,
 *   "risk": "HIGH",
 *   "decision": "BLOCK",
 *   "saved": 38.21,
 *   "wouldHaveLost": 120.50
 * }
 */

import { stateStore, RequestRecord } from './StateStore';

export interface CostEstimate {
  cost: number;
  tokens: number;
  model: string;
}

export interface CostComparison {
  saved: number;
  wouldHaveLost: number;
  actualSpend: number;
  blockedCount: number;
  allowedCount: number;
}

export interface TrackedEvent {
  type: 'BLOCK' | 'ALLOW' | 'WARN';
  cost: number;
  risk: string;
  timestamp: number;
  prompt?: string;
  model?: string;
}

export interface CostTruthResult {
  cost: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  decision: 'ALLOW' | 'WARN' | 'BLOCK';
  saved: number;
  wouldHaveLost: number;
}

/**
 * Cost Truth Engine - Singleton
 * Tracks all financial impact of AI Execution Firewall
 */
export class CostTruthEngine {
  private static instance: CostTruthEngine;
  private events: TrackedEvent[] = [];

  private constructor() {}

  static getInstance(): CostTruthEngine {
    if (!CostTruthEngine.instance) {
      CostTruthEngine.instance = new CostTruthEngine();
    }
    return CostTruthEngine.instance;
  }

  /**
   * Estimate cost for a request using heuristics
   * Rules:
   * - tokens × model pricing
   * - repeated calls multiplier (1.5x for duplicates)
   * - spike multiplier (2x for burst traffic)
   */
  estimateCost(params: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    isDuplicate?: boolean;
    isBurst?: boolean;
  }): CostEstimate {
    const pricing = this.getModelPricing(params.model);
    const inputCost = (params.inputTokens / 1000) * pricing.inputPer1K;
    const outputCost = (params.outputTokens / 1000) * pricing.outputPer1K;
    let cost = inputCost + outputCost;

    // Repeated calls multiplier
    if (params.isDuplicate) {
      cost *= 1.5;
    }

    // Spike multiplier for burst traffic
    if (params.isBurst) {
      cost *= 2.0;
    }

    const totalTokens = params.inputTokens + params.outputTokens;

    return {
      cost: Math.round(cost * 10000) / 10000, // Round to 4 decimals
      tokens: totalTokens,
      model: params.model,
    };
  }

  /**
   * Compare actual vs prevented costs
   * Logic:
   * - saved = sum(blocked requests cost)
   * - wouldHaveLost = saved + actual cost
   */
  compareCost(hours: number = 24): CostComparison {
    const stats = stateStore.getStats(hours);

    // Calculate saved: sum of costs for all blocked requests
    const blockedRequests = stateStore.getBlocked(1000);
    const saved = blockedRequests.reduce((sum, req) => sum + req.estimatedCost, 0);

    // Calculate actual spend: sum of costs for allowed requests
    const actualSpend = stats.totalCost;

    // Would have lost = saved + actual (what we would have spent without firewall)
    const wouldHaveLost = saved + actualSpend;

    return {
      saved: Math.round(saved * 100) / 100,
      wouldHaveLost: Math.round(wouldHaveLost * 100) / 100,
      actualSpend: Math.round(actualSpend * 100) / 100,
      blockedCount: stats.blockedRequests,
      allowedCount: stats.totalRequests - stats.blockedRequests,
    };
  }

  /**
   * Track an event for cost truth calculations
   */
  trackEvent(event: Omit<TrackedEvent, 'timestamp'>): void {
    const fullEvent: TrackedEvent = {
      ...event,
      timestamp: Date.now(),
    };
    this.events.push(fullEvent);

    // Keep only last 10000 events to prevent memory bloat
    if (this.events.length > 10000) {
      this.events = this.events.slice(-10000);
    }
  }

  /**
   * Get events for a time window
   */
  getEvents(minutes: number = 60): TrackedEvent[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.events.filter((e) => e.timestamp >= cutoff);
  }

  /**
   * Get total savings summary
   */
  getSavingsSummary(): {
    totalSaved: number;
    totalWouldHaveLost: number;
    protectionRate: number;
  } {
    const comparison = this.compareCost(24 * 30); // 30 days
    const totalRequests = comparison.blockedCount + comparison.allowedCount;
    const protectionRate = totalRequests > 0 ? (comparison.blockedCount / totalRequests) * 100 : 0;

    return {
      totalSaved: comparison.saved,
      totalWouldHaveLost: comparison.wouldHaveLost,
      protectionRate: Math.round(protectionRate * 100) / 100,
    };
  }

  /**
   * Create universal output format for any request
   */
  createTruthResult(params: {
    cost: number;
    risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    decision: 'ALLOW' | 'WARN' | 'BLOCK';
    wouldHaveLost?: number;
  }): CostTruthResult {
    const comparison = this.compareCost();

    // If blocked, add this cost to saved
    const saved = params.decision === 'BLOCK' ? params.cost : 0;

    // Would have lost includes this request if it were allowed
    const wouldHaveLost =
      params.wouldHaveLost ?? comparison.wouldHaveLost + (params.decision === 'BLOCK' ? params.cost : 0);

    return {
      cost: params.cost,
      risk: params.risk,
      decision: params.decision,
      saved: Math.round(saved * 100) / 100,
      wouldHaveLost: Math.round(wouldHaveLost * 100) / 100,
    };
  }

  /**
   * Get model pricing per 1K tokens
   */
  private getModelPricing(model: string): { inputPer1K: number; outputPer1K: number } {
    const pricing: Record<string, { inputPer1K: number; outputPer1K: number }> = {
      'gpt-4': { inputPer1K: 0.03, outputPer1K: 0.06 },
      'gpt-4-32k': { inputPer1K: 0.06, outputPer1K: 0.12 },
      'gpt-4-turbo': { inputPer1K: 0.01, outputPer1K: 0.03 },
      'gpt-4o': { inputPer1K: 0.005, outputPer1K: 0.015 },
      'gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 },
      'gpt-3.5-turbo': { inputPer1K: 0.0005, outputPer1K: 0.0015 },
      'claude-3-opus': { inputPer1K: 0.015, outputPer1K: 0.075 },
      'claude-3-sonnet': { inputPer1K: 0.003, outputPer1K: 0.015 },
      'claude-3-haiku': { inputPer1K: 0.00025, outputPer1K: 0.00125 },
      default: { inputPer1K: 0.01, outputPer1K: 0.03 },
    };

    // Find matching model or use default
    const key = Object.keys(pricing).find((k) => model.toLowerCase().includes(k.toLowerCase()));
    return key ? pricing[key] : pricing['default'];
  }

  /**
   * Clear all tracked events
   */
  clear(): void {
    this.events = [];
  }
}

// Export singleton instance
export const costTruthEngine = CostTruthEngine.getInstance();
