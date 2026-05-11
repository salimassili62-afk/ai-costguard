/**
 * AI CostGuard — Simplified types for 10/10 experience
 */

export interface GuardConfig {
  /** Daily budget in USD */
  budget: number;
  /** Enable behavioral analysis */
  behaviorAnalysis?: boolean;
}

export interface RequestContext {
  model: string;
  tokens: number;
  estimatedCost: number;
  timestamp: number;
  prompt: string;
}

export interface GuardState {
  requestCount: number;
  totalCost: number;
  lastRequestTime: number;
  blockedCount: number;
}

export type GuardDecision = 'allow' | 'block';
