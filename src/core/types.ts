/**
 * Minimal types for AI CostGuard MVP
 */

export interface CostGuardConfig {
  /** Max tokens per single request */
  maxTokensPerRequest: number;
  /** Max requests per minute */
  maxRequestsPerMinute: number;
  /** Max total cost per day in USD */
  maxTotalCostPerDay: number;
  /** Enable loop detection */
  loopDetection: boolean;
  /** Alert callback when limit hit */
  onLimitHit?: (reason: string, cost: number) => void;
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
  recentPrompts: string[];
  blockedCount: number;
}

export type GuardDecision = 'allow' | 'block';
