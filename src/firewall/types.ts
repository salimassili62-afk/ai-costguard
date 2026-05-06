export type GuardDecision = 'allow' | 'block' | 'throttle';

export interface GuardRequest {
  model: string;
  prompt: string;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface GuardPolicy {
  maxCostUsd: number;
  throttleCostUsd: number;
  loopWindowMs: number;
  loopThreshold: number;
  requestsPerMinute: number;
  strict: boolean;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
}

export interface GuardResult {
  decision: GuardDecision;
  reason: string;
  estimatedCostUsd: number;
  costAvoidedUsd: number;
  loopCount: number;
  throttleMs?: number;
  ruleTriggered: string;
  policy: GuardPolicy;
  latencyMs: number;
}

export interface DecisionExplanation {
  decision: GuardDecision;
  reason: string;
  costAvoided: number;
  ruleTriggered: string;
}
