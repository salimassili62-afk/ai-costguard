/**
 * AERL - Recovery Engine
 * 
 * When risk is high, suggests alternative execution paths:
 * - Alternative tool selection
 * - Retry strategy optimization
 * - Fallback tool selection
 * - Minimal intervention correction
 * 
 * PURPOSE: Ensure agent success even when primary path fails
 * 
 * REQUIREMENTS:
 * - Suggest in <1ms
 * - Multiple recovery levels
 * - Degrades gracefully
 * - No external I/O in hot path
 */

import { FailureAction } from './FailurePrediction';

export interface RecoveryPlan {
  primaryAction: FailureAction;
  alternatives: RecoveryAlternative[];
  fallbackAction: FailureAction;
  estimatedSuccessRate: number;
  estimatedCost: number;
  timeToRecoverMs: number;
}

export interface RecoveryAlternative {
  action: FailureAction;
  tool?: string;
  parameters?: Record<string, unknown>;
  estimatedSuccessRate: number;
  estimatedCost: number;
  reason: string;
}

export interface ToolRegistry {
  name: string;
  cost: number;      // Relative cost (1 = baseline)
  reliability: number; // 0-1
  speed: number;     // 1 = fast, 0 = slow
  capabilities: string[];
}

export class RecoveryEngine {
  private toolRegistry: Map<string, ToolRegistry>;

  constructor() {
    this.toolRegistry = new Map();
    this.initializeDefaultTools();
  }

  private initializeDefaultTools(): void {
    // Default tool registry - can be extended
    this.toolRegistry.set('gpt-4', {
      name: 'gpt-4',
      cost: 1.0,
      reliability: 0.95,
      speed: 0.8,
      capabilities: ['reasoning', 'coding', 'analysis'],
    });

    this.toolRegistry.set('gpt-3.5', {
      name: 'gpt-3.5',
      cost: 0.1,
      reliability: 0.85,
      speed: 1.0,
      capabilities: ['reasoning', 'simple_coding'],
    });

    this.toolRegistry.set('claude-3', {
      name: 'claude-3',
      cost: 0.9,
      reliability: 0.93,
      speed: 0.85,
      capabilities: ['reasoning', 'analysis', 'long_context'],
    });

    this.toolRegistry.set('local-llm', {
      name: 'local-llm',
      cost: 0.01,
      reliability: 0.7,
      speed: 0.6,
      capabilities: ['simple_reasoning'],
    });
  }

  /**
   * Generate recovery plan for high-risk execution
   */
  generateRecovery(
    primaryTool: string,
    recommendedAction: FailureAction,
    alternativeTool?: string
  ): RecoveryPlan {
    const alternatives: RecoveryAlternative[] = [];
    
    // Level 1: Retry with same tool (if failure is transient)
    if (recommendedAction === 'retry_immediate' || recommendedAction === 'retry_backoff') {
      alternatives.push({
        action: recommendedAction,
        tool: primaryTool,
        parameters: { retry_count: 1, backoff_ms: 500 },
        estimatedSuccessRate: 0.7,
        estimatedCost: this.getToolCost(primaryTool),
        reason: 'Retry with same tool, transient failure likely',
      });
    }

    // Level 2: Substitute tool
    if (recommendedAction === 'substitute_tool' || alternativeTool) {
      const substitute = alternativeTool || this.findCheaperAlternative(primaryTool);
      if (substitute && substitute !== primaryTool) {
        alternatives.push({
          action: 'substitute_tool',
          tool: substitute,
          estimatedSuccessRate: this.getToolReliability(substitute) * 0.9,
          estimatedCost: this.getToolCost(substitute),
          reason: `Substitute ${primaryTool} with cheaper ${substitute}`,
        });
      }
    }

    // Level 3: Simplify request (use allow with modified parameters)
    alternatives.push({
      action: 'allow',
      tool: primaryTool,
      parameters: { 
        max_tokens: 1000,  // Reduce token count
        temperature: 0.2,  // More deterministic
      },
      estimatedSuccessRate: 0.75,
      estimatedCost: this.getToolCost(primaryTool) * 0.5,
      reason: 'Simplify request - fewer tokens, more deterministic',
    });

    // Level 4: Use local/cached fallback
    const localTool = this.findLocalFallback(primaryTool);
    if (localTool) {
      alternatives.push({
        action: 'substitute_tool',
        tool: localTool,
        estimatedSuccessRate: 0.6,
        estimatedCost: this.getToolCost(localTool),
        reason: 'Use local/cached fallback for cost reduction',
      });
    }

    // Calculate aggregate stats
    const totalCost = alternatives.reduce((sum, alt) => sum + alt.estimatedCost, 0);
    const avgSuccess = alternatives.length > 0
      ? alternatives.reduce((sum, alt) => sum + alt.estimatedSuccessRate, 0) / alternatives.length
      : 0.5;

    return {
      primaryAction: recommendedAction,
      alternatives,
      fallbackAction: alternatives.length > 0 ? alternatives[alternatives.length - 1].action : 'block',
      estimatedSuccessRate: Math.max(0.5, avgSuccess),
      estimatedCost: totalCost,
      timeToRecoverMs: alternatives.length * 100, // Rough estimate
    };
  }

  /**
   * Find cheaper alternative tool
   */
  private findCheaperAlternative(toolName: string): string | undefined {
    const primary = this.toolRegistry.get(toolName);
    if (!primary) return undefined;

    let bestAlternative: string | undefined;
    let bestScore = -1;

    for (const [name, tool] of this.toolRegistry) {
      if (name === toolName) continue;
      
      // Score based on cost savings + reliability
      const costSavings = (primary.cost - tool.cost) / primary.cost;
      const reliabilityRatio = tool.reliability / primary.reliability;
      const score = costSavings * 0.6 + reliabilityRatio * 0.4;

      if (score > bestScore && tool.cost < primary.cost) {
        bestScore = score;
        bestAlternative = name;
      }
    }

    return bestAlternative;
  }

  /**
   * Find local/cached fallback
   */
  private findLocalFallback(toolName: string): string | undefined {
    // Prefer local-llm if available
    if (this.toolRegistry.has('local-llm')) {
      return 'local-llm';
    }

    // Otherwise find cheapest
    let cheapest: string | undefined;
    let minCost = Infinity;

    for (const [name, tool] of this.toolRegistry) {
      if (tool.cost < minCost) {
        minCost = tool.cost;
        cheapest = name;
      }
    }

    return cheapest;
  }

  private getToolCost(toolName: string): number {
    return this.toolRegistry.get(toolName)?.cost || 1.0;
  }

  private getToolReliability(toolName: string): number {
    return this.toolRegistry.get(toolName)?.reliability || 0.8;
  }

  /**
   * Register custom tool
   */
  registerTool(tool: ToolRegistry): void {
    this.toolRegistry.set(tool.name, tool);
  }

  /**
   * Get optimal retry delay based on failure count
   */
  getRetryDelay(failureCount: number): number {
    // Exponential backoff: 500ms, 1000ms, 2000ms, max 5000ms
    return Math.min(500 * Math.pow(2, failureCount), 5000);
  }

  /**
   * Check if circuit breaker should trip
   */
  shouldTripCircuitBreaker(failureCount: number, timeWindowMs: number): boolean {
    // Trip if >5 failures in last minute
    return failureCount > 5 && timeWindowMs < 60000;
  }
}

export const recoveryEngine = new RecoveryEngine();
