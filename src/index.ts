export * from './config';
export * from './token-counter';
export * from './logger';
export * from './proxy';
export * from './wrapper';
export * from './storage';

// Core exports - explicit to avoid conflict with config.Decision
export { DetectionEngine, detectionEngine, DetectionResult, AnalyzeInput } from './core/DetectionEngine';
export { StateStore, stateStore, RequestRecord, StateStats } from './core/StateStore';
export { CostTruthEngine, costTruthEngine, CostTruthResult, CostComparison } from './core/CostTruthEngine';
export { Logger, logger, LogEntry, LogStats } from './core/Logger';
export { CostLedger, costLedger, CostLedgerEntry, CostEstimate, CostActual } from './core/CostLedger';
export { AuditTrail, auditTrail, AuditEntry, AuditStats } from './core/AuditTrail';
export { PricingConfig, pricingConfig, ModelPricing, TokenUsage, CostCalculation } from './core/PricingConfig';
export { SessionStatsManager, sessionStats, SessionStats, DailyStats } from './core/SessionStats';
export { PolicyEngine, policyEngine, BudgetStatus, EffectivePolicy, PolicyEvaluationResult } from './core/PolicyEngine';
export { AlertManager, alertManager, FirewallAlert } from './core/AlertManager';
export { FirewallMetadata, TokenBreakdown } from './core/types';

export { AIExecutionFirewall } from './wrapper';

// Middleware exports - AI Execution Firewall as middleware layer
export {
  withFirewall,
  wrapFunction,
  expressFirewall,
  withFirewallHandler,
  checkRequest,
  getFirewallStats,
  FirewallOptions,
  FirewallMiddlewareOptions,
  OpenAIRequest,
  ChatMessage,
  AIRequestBody,
} from './wrapper/aiFirewall';
