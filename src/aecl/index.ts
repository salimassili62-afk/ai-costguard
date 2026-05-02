/**
 * AECL - AI Execution Control Layer
 * Production-grade execution interception
 * 
 * CORE MODULES:
 * - ExecutionInterceptor: <5ms decision engine
 * - RiskEngine: 0-1 risk scoring
 * - PolicyEngine: simple rule evaluation
 * - ExecutionMemory: hashed trace storage
 * - ROITelemetry: cost savings tracking
 * 
 * USAGE:
 * ```typescript
 * import { aecl } from 'ai-execution-control/aecl';
 * 
 * const result = aecl.intercept({
 *   id: 'req-1',
 *   provider: 'openai',
 *   operation: 'chat.completions.create',
 *   estimatedTokens: 2000,
 *   estimatedCost: 0.06,
 *   context: {
 *     sessionId: 'sess-1',
 *     agentId: 'agent-1',
 *     stepNumber: 5,
 *     previousCalls: 4,
 *     totalTokens: 8000,
 *     totalCost: 0.24,
 *     startTime: Date.now(),
 *   },
 *   inputHash: 'hash-of-prompt',
 * });
 * 
 * if (result.decision === 'block') {
 *   console.log('Blocked:', result.reason);
 *   console.log('Saved: $', result.estimatedSavings);
 * }
 * ```
 */

export { ExecutionInterceptor, interceptor } from './ExecutionInterceptor';
export { RiskEngine, riskEngine } from './RiskEngine';
export { PolicyEngine, policyEngine } from './PolicyEngine';
export { ExecutionMemory, executionMemory } from './ExecutionMemory';
export { ROITelemetry, roiTelemetry } from './ROITelemetry';

// Unified API
import { ExecutionInterceptor } from './ExecutionInterceptor';
import { RiskEngine } from './RiskEngine';
import { PolicyEngine } from './PolicyEngine';
import { ExecutionMemory } from './ExecutionMemory';
import { ROITelemetry } from './ROITelemetry';

export interface AECLConfig {
  failOpen?: boolean;
  maxLatencyMs?: number;
  maxCostPerSession?: number;
  maxStepsPerSession?: number;
  maxCostPerRequest?: number;
}

/**
 * Unified AECL interface
 */
export class AECL {
  private interceptor: ExecutionInterceptor;
  private riskEngine: RiskEngine;
  private policyEngine: PolicyEngine;
  private memory: ExecutionMemory;
  private telemetry: ROITelemetry;

  constructor(config: AECLConfig = {}) {
    this.interceptor = new ExecutionInterceptor({
      failOpen: config.failOpen ?? true,
      maxLatencyMs: config.maxLatencyMs ?? 5,
      defaultPolicy: {
        maxCostPerSession: config.maxCostPerSession ?? 10,
        maxStepsPerSession: config.maxStepsPerSession ?? 50,
        maxCostPerRequest: config.maxCostPerRequest ?? 5,
      },
    });

    this.riskEngine = new RiskEngine();
    this.policyEngine = new PolicyEngine();
    this.memory = new ExecutionMemory();
    this.telemetry = new ROITelemetry();
  }

  /**
   * Main interception method
   */
  intercept = this.interceptor.intercept.bind(this.interceptor);

  /**
   * Calculate risk score
   */
  assessRisk = this.riskEngine.assess.bind(this.riskEngine);

  /**
   * Evaluate policy
   */
  evaluatePolicy = this.policyEngine.evaluate.bind(this.policyEngine);

  /**
   * Record execution for deduplication
   */
  recordExecution = this.memory.record.bind(this.memory);

  /**
   * Check for duplicates
   */
  checkDuplicate = this.memory.checkDeduplication.bind(this.memory);

  /**
   * Record execution trace
   */
  recordExecution(sessionId: string, trace: any) {
    this.memory.record({
      sessionId,
      stepNumber: trace.stepNumber,
      operation: trace.operation,
      inputHash: trace.inputHash,
      cost: trace.cost,
      tokens: trace.tokens,
      timestamp: trace.timestamp,
      durationMs: trace.durationMs,
    });
  }

  /**
   * Log decision for ROI tracking
   */
  logDecision = this.telemetry.log.bind(this.telemetry);

  /**
   * Get ROI metrics
   */
  getROI = this.telemetry.get7DayReport.bind(this.telemetry);

  /**
   * Get dashboard summary
   */
  getDashboard = this.telemetry.getDashboardSummary.bind(this.telemetry);

  /**
   * Export telemetry CSV
   */
  exportCSV = this.telemetry.exportCSV.bind(this.telemetry);
}

// Default instance
export const aecl = new AECL();
