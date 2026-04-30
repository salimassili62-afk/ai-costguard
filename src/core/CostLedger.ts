/**
 * CostLedger.ts - Financial Ledger Engine
 * 
 * Tracks estimated vs actual costs:
 * - Estimated cost BEFORE execution
 * - Actual cost AFTER execution (from real API responses)
 * - Difference calculation: saved = wouldHaveSpent - actualSpent
 * 
 * Output format:
 * {
 *   cost: 0.12,
 *   wouldHaveLost: 120.50,
 *   saved: 38.21
 * }
 */

import { logger, LogEntry } from './Logger';
import { pricingConfig, TokenUsage, CostCalculation } from './PricingConfig';

export interface CostEstimate {
  cost: number;
  tokens: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CostActual {
  cost: number;
  tokens: number;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface CostLedgerEntry {
  id: string;
  timestamp: number;
  prompt: string;
  model: string;
  estimated: CostEstimate;
  actual?: CostActual;
  variance?: number; // actual - estimated
  saved: number;
  wouldHaveLost: number;
}

export interface CostSummary {
  totalEstimated: number;
  totalActual: number;
  totalSaved: number;
  totalWouldHaveLost: number;
  averageVariance: number;
  accuracy: number; // How close estimates were to actual
  entries: CostLedgerEntry[];
}

/**
 * CostLedger - Tracks financial truth of AI requests
 * Calculates: saved = wouldHaveLost - actualSpent
 */
export class CostLedger {
  private static instance: CostLedger;
  private entries: CostLedgerEntry[] = [];
  private maxEntries: number = 5000;

  private constructor() {}

  static getInstance(): CostLedger {
    if (!CostLedger.instance) {
      CostLedger.instance = new CostLedger();
    }
    return CostLedger.instance;
  }

  /**
   * Record estimated cost (before execution)
   */
  recordEstimate(params: {
    prompt: string;
    model: string;
    estimatedCost: number;
    estimatedTokens: number;
    inputTokens?: number;
    outputTokens?: number;
    saved: number;
    wouldHaveLost: number;
  }): string {
    const id = this.generateId();
    
    const entry: CostLedgerEntry = {
      id,
      timestamp: Date.now(),
      prompt: params.prompt.substring(0, 200), // Truncate for storage
      model: params.model,
      estimated: {
        cost: params.estimatedCost,
        tokens: params.estimatedTokens,
        model: params.model,
        inputTokens: params.inputTokens || Math.ceil(params.estimatedTokens * 0.3),
        outputTokens: params.outputTokens || Math.ceil(params.estimatedTokens * 0.7),
      },
      saved: params.saved,
      wouldHaveLost: params.wouldHaveLost,
    };

    this.entries.push(entry);
    this.trimEntries();

    return id;
  }

  /**
   * Update with actual cost from API response (after execution)
   * Extracts real token usage and calculates actual cost
   */
  recordActualFromResponse(id: string, apiResponse: any, model: string): boolean {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return false;

    // Extract token usage from API response
    const usage = pricingConfig.extractUsage(apiResponse);
    
    if (!usage) {
      // Fallback: if no usage data, keep estimated as actual
      entry.actual = {
        cost: entry.estimated.cost,
        tokens: entry.estimated.tokens,
        usage: {
          prompt_tokens: entry.estimated.inputTokens,
          completion_tokens: entry.estimated.outputTokens,
          total_tokens: entry.estimated.tokens,
        },
      };
    } else {
      // Calculate real cost from actual token usage
      const costCalc = pricingConfig.calculateCost(model, usage);
      
      entry.actual = {
        cost: costCalc.totalCost,
        tokens: usage.total_tokens,
        usage: {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        },
      };
    }

    entry.variance = entry.actual.cost - entry.estimated.cost;

    // Recalculate saved based on actual
    // saved = wouldHaveLost - actualSpent
    if (entry.actual) {
      entry.saved = Math.max(0, entry.wouldHaveLost - entry.actual.cost);
    }

    return true;
  }

  /**
   * Update with actual cost (after execution) - legacy method
   */
  recordActual(id: string, actualCost: CostActual): boolean {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return false;

    entry.actual = actualCost;
    entry.variance = actualCost.cost - entry.estimated.cost;

    // Recalculate saved based on actual
    if (entry.actual) {
      entry.saved = Math.max(0, entry.wouldHaveLost - entry.actual.cost);
    }

    return true;
  }

  /**
   * Get cost summary for a time period
   */
  getSummary(hours: number = 24): CostSummary {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const entries = this.entries.filter(e => e.timestamp >= cutoff);

    let totalEstimated = 0;
    let totalActual = 0;
    let totalSaved = 0;
    let totalWouldHaveLost = 0;
    let varianceSum = 0;
    let actualCount = 0;

    for (const entry of entries) {
      totalEstimated += entry.estimated.cost;
      totalSaved += entry.saved;
      totalWouldHaveLost += entry.wouldHaveLost;

      if (entry.actual) {
        totalActual += entry.actual.cost;
        varianceSum += Math.abs(entry.variance || 0);
        actualCount++;
      }
    }

    const averageVariance = actualCount > 0 ? varianceSum / actualCount : 0;
    
    // Accuracy: 100% = perfect estimates, 0% = completely wrong
    const accuracy = totalActual > 0
      ? Math.max(0, 100 - (averageVariance / totalActual * 100))
      : 100;

    return {
      totalEstimated: Math.round(totalEstimated * 10000) / 10000,
      totalActual: Math.round(totalActual * 10000) / 10000,
      totalSaved: Math.round(totalSaved * 10000) / 10000,
      totalWouldHaveLost: Math.round(totalWouldHaveLost * 10000) / 10000,
      averageVariance: Math.round(averageVariance * 10000) / 10000,
      accuracy: Math.round(accuracy * 100) / 100,
      entries: entries.slice(0, 100), // Return last 100
    };
  }

  /**
   * Create ledger output format
   */
  createLedgerOutput(params: {
    estimatedCost: number;
    actualCost?: number;
    saved: number;
    wouldHaveLost: number;
  }): {
    cost: number;
    wouldHaveLost: number;
    saved: number;
    variance?: number;
  } {
    const output: any = {
      cost: params.estimatedCost,
      wouldHaveLost: params.wouldHaveLost,
      saved: params.saved,
    };

    if (params.actualCost !== undefined) {
      output.variance = Math.round((params.actualCost - params.estimatedCost) * 10000) / 10000;
    }

    return output;
  }

  /**
   * Get entries with actual costs recorded
   */
  getCompletedEntries(limit: number = 100): CostLedgerEntry[] {
    return this.entries
      .filter(e => e.actual !== undefined)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get savings report
   */
  getSavingsReport(hours: number = 24): {
    period: string;
    estimatedSpend: number;
    actualSpend: number;
    saved: number;
    wouldHaveLost: number;
    protectionRate: number;
  } {
    const summary = this.getSummary(hours);
    
    const protectionRate = summary.totalWouldHaveLost > 0
      ? (summary.totalSaved / summary.totalWouldHaveLost) * 100
      : 0;

    return {
      period: `${hours}h`,
      estimatedSpend: summary.totalEstimated,
      actualSpend: summary.totalActual,
      saved: summary.totalSaved,
      wouldHaveLost: summary.totalWouldHaveLost,
      protectionRate: Math.round(protectionRate * 100) / 100,
    };
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get total entries count
   */
  getCount(): number {
    return this.entries.length;
  }

  /**
   * Trim entries to max limit
   */
  private trimEntries(): void {
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `ledger-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const costLedger = CostLedger.getInstance();
