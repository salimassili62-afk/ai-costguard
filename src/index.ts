export * from './config';
export * from './token-counter';
export * from './logger';
export * from './proxy';
export * from './wrapper';

// Core exports - explicit to avoid conflict with config.Decision
export { DetectionEngine, detectionEngine, DetectionResult, AnalyzeInput } from './core/DetectionEngine';
export { StateStore, stateStore, RequestRecord, StateStats } from './core/StateStore';

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
