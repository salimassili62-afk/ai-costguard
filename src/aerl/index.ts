/**
 * AERL - AI Execution Reliability Layer
 * 
 * Runtime reliability system for autonomous AI agents.
 * Ensures agents succeed reliably, safely, and cost-predictably.
 * 
 * CORE MODULES:
 * - ExecutionInterceptor: <5ms decision engine
 * - ReliabilityEngine: 0-1 reliability scoring
 * - ExecutionGraph: Multi-step workflow tracking
 * - FailurePrediction: Pre-execution failure prediction
 * - RecoveryEngine: Alternative execution paths
 * - ExecutionMemory: Hashed pattern storage
 * - ReliabilityTelemetry: ROI + success tracking
 * 
 * USAGE:
 * ```typescript
 * import { aerl } from 'ai-execution-reliability/aerl';
 * 
 * // 1. Initialize workflow
 * aerl.initWorkflow('wf-1', 'sess-1');
 * 
 * // 2. Intercept each execution
 * const result = aerl.intercept({
 *   id: 'step-1',
 *   provider: 'openai',
 *   operation: 'chat.completions.create',
 *   estimatedCost: 0.06,
 *   context: { sessionId: 'sess-1', workflowId: 'wf-1', stepNumber: 1, ... },
 *   inputHash: 'sha256-of-input',
 * });
 * 
 * // 3. Handle decision
 * if (result.action === 'block') {
 *   console.log('Blocked:', result.reason);
 * } else if (result.action === 'modify') {
 *   console.log('Using alternative:', result.suggestedModification);
 * }
 * 
 * // 4. Track execution in graph
 * aerl.trackGraph('wf-1', {
 *   id: 'step-1',
 *   type: 'llm',
 *   status: 'running',
 *   operation: 'chat.completions.create',
 *   inputHash: 'hash',
 *   cost: 0.06,
 *   tokens: 2000,
 *   durationMs: 1500,
 *   timestamp: Date.now(),
 * });
 * 
 * // 5. Get reliability metrics
 * const metrics = aerl.getMetrics();
 * console.log('Success rate:', metrics.successRate);
 * console.log('Cost saved:', metrics.costSaved);
 * ```
 */

export { ExecutionInterceptor, interceptor } from './ExecutionInterceptor';
export { ReliabilityEngine, reliabilityEngine } from './ReliabilityEngine';
export { ExecutionGraphTracker, graphTracker } from './ExecutionGraph';
export { FailurePredictionSystem, failurePredictor } from './FailurePrediction';
export { RecoveryEngine, recoveryEngine } from './RecoveryEngine';
export { ExecutionMemory, executionMemory } from './ExecutionMemory';
export { ReliabilityTelemetry, reliabilityTelemetry } from './ReliabilityTelemetry';

// Unified API
import { ExecutionInterceptor, ExecutionRequest, DecisionResult } from './ExecutionInterceptor';
import { ReliabilityEngine } from './ReliabilityEngine';
import { ExecutionGraphTracker, ExecutionNode } from './ExecutionGraph';
import { FailurePredictionSystem } from './FailurePrediction';
import { RecoveryEngine } from './RecoveryEngine';
import { ExecutionMemory } from './ExecutionMemory';
import { ReliabilityTelemetry } from './ReliabilityTelemetry';

export interface AERLConfig {
  failOpen?: boolean;
  maxLatencyMs?: number;
  maxCostPerWorkflow?: number;
  maxStepsPerWorkflow?: number;
}

export class AERL {
  private interceptor: ExecutionInterceptor;
  private reliabilityEngine: ReliabilityEngine;
  private graphTracker: ExecutionGraphTracker;
  private failurePredictor: FailurePredictionSystem;
  private recoveryEngine: RecoveryEngine;
  private memory: ExecutionMemory;
  private telemetry: ReliabilityTelemetry;

  constructor(config: AERLConfig = {}) {
    this.interceptor = new ExecutionInterceptor({
      failOpen: config.failOpen ?? true,
      maxLatencyMs: config.maxLatencyMs ?? 5,
      defaultPolicy: {
        maxCostPerWorkflow: config.maxCostPerWorkflow ?? 50,
        maxStepsPerWorkflow: config.maxStepsPerWorkflow ?? 100,
        maxCostPerStep: 10,
        minReliabilityScore: 0.3,
      },
    });

    this.reliabilityEngine = new ReliabilityEngine();
    this.graphTracker = new ExecutionGraphTracker();
    this.failurePredictor = new FailurePredictionSystem();
    this.recoveryEngine = new RecoveryEngine();
    this.memory = new ExecutionMemory();
    this.telemetry = new ReliabilityTelemetry();
  }

  /**
   * Initialize workflow graph
   */
  initWorkflow(workflowId: string, sessionId: string): void {
    this.graphTracker.initGraph(workflowId, sessionId);
  }

  /**
   * Main interception - allow/block/modify
   */
  intercept(request: ExecutionRequest): DecisionResult {
    const result = this.interceptor.intercept(request);

    // Log telemetry
    this.telemetry.log({
      timestamp: Date.now(),
      sessionId: request.context.sessionId,
      workflowId: request.context.workflowId,
      requestId: request.id,
      decision: result.action,
      riskScore: 1 - result.reliabilityScore,
      reliabilityScore: result.reliabilityScore,
      estimatedCost: request.estimatedCost,
      latencyMs: result.latencyMs,
    });

    return result;
  }

  /**
   * Score execution reliability
   */
  scoreExecution(context: {
    sessionId: string;
    workflowId: string;
    stepNumber: number;
    recentResults: ('success' | 'failure' | 'partial')[];
    totalCost: number;
    tokenVelocity: number;
    costVelocity: number;
  }) {
    return this.reliabilityEngine.assess({
      sessionId: context.sessionId,
      workflowId: context.workflowId,
      stepNumber: context.stepNumber,
      recentResults: context.recentResults,
      tokenVelocity: context.tokenVelocity,
      costVelocity: context.costVelocity,
      toolSwitches: 0,
    });
  }

  /**
   * Predict failure before execution
   */
  predictFailure(workflowId: string, nextOperation: string) {
    const graph = this.graphTracker.analyze(workflowId);
    const reliability = this.scoreExecution({
      sessionId: workflowId,
      workflowId,
      stepNumber: graph.depth,
      recentResults: [],
      totalCost: 0,
      tokenVelocity: 0,
      costVelocity: 0,
    });

    return this.failurePredictor.predict(workflowId, graph, reliability, nextOperation);
  }

  /**
   * Generate recovery plan
   */
  recoverExecution(primaryTool: string, recommendedAction: string, alternativeTool?: string) {
    return this.recoveryEngine.generateRecovery(
      primaryTool,
      recommendedAction as any,
      alternativeTool
    );
  }

  /**
   * Track execution in graph
   */
  trackGraph(workflowId: string, node: ExecutionNode, dependencies?: string[]) {
    this.graphTracker.addNode(workflowId, node, dependencies);
  }

  /**
   * Analyze workflow graph
   */
  analyzeGraph(workflowId: string) {
    return this.graphTracker.analyze(workflowId);
  }

  /**
   * Record execution result
   */
  recordResult(requestId: string, actualCost: number, success: boolean): void {
    this.telemetry.recordResult(requestId, actualCost, success);
  }

  /**
   * Get reliability metrics
   */
  getMetrics() {
    return this.telemetry.getMetrics();
  }

  /**
   * Get 7-day report
   */
  get7DayReport() {
    return this.telemetry.get7DayReport();
  }

  /**
   * Get dashboard summary
   */
  getDashboard() {
    return this.telemetry.getDashboardSummary();
  }

  /**
   * Export CSV
   */
  exportCSV() {
    return this.telemetry.exportCSV();
  }

  /**
   * Get interceptor metrics (latency, cache hit rate)
   */
  getInterceptorMetrics() {
    return this.interceptor.getMetrics();
  }
}

// Default instance
export const aerl = new AERL();
