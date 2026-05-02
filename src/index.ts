export * from './config';
export * from './token-counter';
export * from './logger';
export * from './proxy';
export * from './wrapper';

// Core exports - explicit to avoid conflict with config.Decision
export { DetectionEngine, detectionEngine, DetectionResult, AnalyzeInput } from './core/DetectionEngine';
export { StateStore, stateStore, RequestRecord, StateStats } from './core/StateStore';
export { CostTruthEngine, costTruthEngine, CostTruthResult, CostComparison } from './core/CostTruthEngine';
export { Logger, logger, LogEntry, LogStats } from './core/Logger';
export { CostLedger, costLedger, CostLedgerEntry, CostEstimate, CostActual } from './core/CostLedger';
export { AuditTrail, auditTrail, AuditEntry, AuditStats } from './core/AuditTrail';
export { PricingConfig, pricingConfig, ModelPricing, TokenUsage, CostCalculation } from './core/PricingConfig';
export { SessionStatsManager, sessionStats, SessionStats, DailyStats } from './core/SessionStats';

// AI Execution Control Platform - New Infrastructure Layer
export {
  ExecutionInterceptor,
  executionInterceptor,
  InterceptionMode,
  ExecutionDecision,
  ExecutionRequest,
  ExecutionDecisionResult,
  ExecutionExplanation,
} from './core/ExecutionInterceptor';

export {
  AgentBehaviorGraph,
  agentBehaviorGraph,
  AgentAction,
  AgentActionType,
  WorkflowState,
  BehaviorAnalysis,
  LoopDetectionResult,
} from './core/AgentBehaviorGraph';

export {
  PolicyEngine,
  policyEngine,
  PolicySet,
  PolicyRule,
  PolicyCondition,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  PolicyLevel,
  EnforcementMode,
} from './core/PolicyEngine';

export {
  CostPredictionEngine,
  costPredictionEngine,
  CostPrediction,
  CostPredictionRequest,
  BudgetAnalysis,
  BurnRateMetrics,
} from './core/CostPredictionEngine';

export {
  LearningSystem,
  learningSystem,
  AnonymizedPattern,
  DetectionImprovement,
  CommunityPattern,
} from './core/LearningSystem';

export {
  ExplainabilityLayer,
  explainabilityLayer,
  ExplanationOutput,
  ExplanationSection,
  ExplanationRequest,
} from './core/ExplainabilityLayer';

// AI Execution Operating System (AIE-OS) - The mandatory runtime layer
export {
  ExecutionOS,
  executionOS,
  OSConfig,
  ExecutionOSMode,
  ExecutionPhase,
  SafetyLevel,
  AgentIdentity,
  ExecutionContext,
  ExecutionIntent,
  ExecutionPlan,
  ExecutionStep,
  ExecutionResult,
  SafetyCheck,
} from './os/ExecutionOS';

export {
  SDKInterception,
  wrapOpenAI,
  wrapAnthropic,
} from './os/SDKInterception';

export {
  GlobalIntelligence,
  globalIntelligence,
  PatternType,
  PatternSignature,
  GlobalPattern,
  IntelligenceContribution,
  IntelligenceReport,
  GlobalDetectionImprovement,
} from './os/GlobalIntelligence';

export {
  PolicyMarketplace,
  policyMarketplace,
  PolicyCategory,
  PolicyStatus,
  MarketplacePolicy,
  PolicyRuleDefinition,
  PolicyPublisher,
  PolicyReview,
  PolicyTemplate,
} from './os/PolicyMarketplace';

export { createExecutionOS } from './os';

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
