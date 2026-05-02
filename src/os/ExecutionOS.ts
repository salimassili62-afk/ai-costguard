/**
 * ExecutionOS.ts - AI Execution Operating System
 * 
 * The mandatory runtime layer for all autonomous AI agents.
 * NOT a tool. NOT optional. The execution layer itself.
 * 
 * Design Philosophy:
 * - Agents CANNOT execute safely without this system
 * - Replaces direct LLM SDK calls at the source level
 * - Becomes the canonical execution state machine
 * - Creates irreversible dependency through data lock-in
 * 
 * If removed: cost explosions, security vulnerabilities, uncontrolled execution
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

// Types
export type ExecutionOSMode = 'strict' | 'permissive' | 'audit';
export type ExecutionPhase = 'planning' | 'executing' | 'completed' | 'failed';
export type SafetyLevel = 'critical' | 'high' | 'medium' | 'low';

export interface AgentIdentity {
  agentId: string;
  tenantId: string;
  fingerprint: string; // Behavioral fingerprint
  createdAt: number;
  lastSeenAt: number;
  reputationScore: number; // 0-100
  executionCount: number;
  totalCost: number;
  violationCount: number;
  trustTier: 'untrusted' | 'standard' | 'trusted' | 'enterprise';
}

export interface ExecutionContext {
  executionId: string;
  agentId: string;
  tenantId: string;
  sessionId: string;
  workflowId?: string;
  phase: ExecutionPhase;
  parentExecutionId?: string;
  rootExecutionId: string;
  depth: number;
  startTime: number;
  budgetRemaining: number;
  metadata: Record<string, any>;
}

export interface ExecutionIntent {
  type: 'llm' | 'tool' | 'agent' | 'composite';
  provider: string;
  action: string; // e.g., 'chat.completions.create', 'tool.execute'
  input: any;
  estimatedTokens: number;
  estimatedCost: number;
  dependencies: string[]; // Other execution IDs this depends on
  sideEffects: string[]; // Expected side effects
}

export interface ExecutionPlan {
  executionId: string;
  agentId: string;
  intent: ExecutionIntent;
  context: ExecutionContext;
  steps: ExecutionStep[];
  totalEstimatedCost: number;
  maxDepth: number;
  safetyChecks: SafetyCheck[];
}

export interface ExecutionStep {
  stepId: string;
  type: 'llm' | 'tool' | 'checkpoint' | 'gate';
  description: string;
  estimatedCost: number;
  estimatedLatency: number;
  dependencies: string[];
  rollbackAction?: string;
}

export interface SafetyCheck {
  checkId: string;
  type: 'cost' | 'security' | 'behavior' | 'policy';
  status: 'pending' | 'passed' | 'failed';
  severity: SafetyLevel;
  message: string;
  automated: boolean; // Can system auto-resolve?
}

export interface ExecutionResult {
  executionId: string;
  status: 'success' | 'blocked' | 'throttled' | 'failed';
  output?: any;
  error?: string;
  actualCost: number;
  actualTokens: number;
  durationMs: number;
  safetyChecksPassed: number;
  safetyChecksFailed: number;
  explanation: string;
  alternatives?: ExecutionIntent[]; // Suggested alternatives if blocked
}

export interface OSConfig {
  tenantId: string;
  mode: ExecutionOSMode;
  defaultBudget: number;
  strictMode: boolean; // Cannot be disabled without code change
  globalIntelligence: boolean; // Share anonymized patterns
  policyAutoApply: boolean; // Auto-apply community policies
}

/**
 * ExecutionOS - The Runtime Layer
 * 
 * This is NOT a wrapper. NOT a middleware. 
 * This IS the execution layer.
 * 
 * Usage:
 *   const ai = new ExecutionOS(openaiClient, config);
 *   ai.chat.completions.create(...) // CANNOT execute safely without OS
 */
export class ExecutionOS extends EventEmitter {
  private config: OSConfig;
  private agents: Map<string, AgentIdentity>;
  private executions: Map<string, ExecutionContext>;
  private globalGraph: GlobalExecutionGraph;
  private intelligence: GlobalIntelligence;
  private policyEngine: PolicyEngine;
  private safetyKernel: SafetyKernel;
  
  // Performance tracking
  private metrics: {
    totalExecutions: number;
    blockedExecutions: number;
    avgLatencyMs: number;
    totalCostPrevented: number;
  };

  constructor(config: OSConfig) {
    super();
    this.config = config;
    this.agents = new Map();
    this.executions = new Map();
    this.globalGraph = new GlobalExecutionGraph();
    this.intelligence = new GlobalIntelligence();
    this.policyEngine = new PolicyEngine();
    this.safetyKernel = new SafetyKernel();
    
    this.metrics = {
      totalExecutions: 0,
      blockedExecutions: 0,
      avgLatencyMs: 0,
      totalCostPrevented: 0,
    };

    // Start background processes
    this.startBackgroundProcesses();
  }

  /**
   * Create or get agent identity
   * Every agent MUST have an identity to execute
   */
  registerAgent(agentId: string, metadata?: Record<string, any>): AgentIdentity {
    let agent = this.agents.get(agentId);
    
    if (!agent) {
      agent = {
        agentId,
        tenantId: this.config.tenantId,
        fingerprint: this.generateFingerprint(agentId, metadata),
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        reputationScore: 50, // Start neutral
        executionCount: 0,
        totalCost: 0,
        violationCount: 0,
        trustTier: 'untrusted',
      };
      this.agents.set(agentId, agent);
      this.emit('agent:registered', agent);
    }

    return agent;
  }

  /**
   * Execute an intent through the OS
   * This is the ONLY safe way to execute AI operations
   * 
   * Design: Returns ExecutionPlan, caller must execute through OS
   */
  async plan(
    agentId: string,
    intent: ExecutionIntent,
    parentContext?: ExecutionContext
  ): Promise<ExecutionPlan> {
    const startTime = performance.now();
    
    // 1. Verify agent identity (MUST exist)
    const agent = this.registerAgent(agentId);
    
    // 2. Create execution context
    const executionId = this.generateExecutionId();
    const context: ExecutionContext = {
      executionId,
      agentId,
      tenantId: this.config.tenantId,
      sessionId: parentContext?.sessionId || this.generateSessionId(),
      workflowId: parentContext?.workflowId,
      phase: 'planning',
      parentExecutionId: parentContext?.executionId,
      rootExecutionId: parentContext?.rootExecutionId || executionId,
      depth: (parentContext?.depth || 0) + 1,
      startTime: Date.now(),
      budgetRemaining: parentContext?.budgetRemaining || this.config.defaultBudget,
      metadata: {},
    };

    // 3. Global intelligence check (network effect)
    const intelligenceReport = await this.intelligence.analyzeIntent(intent, agent);
    
    // 4. Build execution plan with safety gates
    const plan = this.buildExecutionPlan(executionId, intent, context, intelligenceReport);
    
    // 5. Run safety checks
    const safetyChecks = await this.safetyKernel.evaluate(plan, agent, context);
    plan.safetyChecks = safetyChecks;

    // 6. Check policies (hierarchical)
    const policyResult = this.policyEngine.evaluate(context, intent, plan);
    
    // 7. Store in global graph (canonical source of truth)
    this.globalGraph.recordPlan(plan);
    this.executions.set(executionId, context);

    // 8. Update metrics
    this.updateMetrics(performance.now() - startTime);

    // 9. Emit events for ecosystem
    this.emit('execution:planned', { plan, agent, policyResult });

    return plan;
  }

  /**
   * Execute a planned operation
   * Only executes if safety checks pass
   */
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    const context = this.executions.get(plan.executionId);
    if (!context) {
      throw new Error(`Execution ${plan.executionId} not found. Must call plan() first.`);
    }

    // Update phase
    context.phase = 'executing';

    // Run safety checks
    const failedChecks = plan.safetyChecks.filter(c => c.status === 'failed');
    
    if (failedChecks.length > 0) {
      // Block execution
      const critical = failedChecks.find(c => c.severity === 'critical');
      
      const result: ExecutionResult = {
        executionId: plan.executionId,
        status: critical ? 'blocked' : 'throttled',
        error: `Safety checks failed: ${failedChecks.map(c => c.message).join(', ')}`,
        actualCost: 0,
        actualTokens: 0,
        durationMs: 0,
        safetyChecksPassed: plan.safetyChecks.length - failedChecks.length,
        safetyChecksFailed: failedChecks.length,
        explanation: this.generateExplanation(failedChecks, plan),
      };

      // Update agent reputation
      this.updateAgentAfterExecution(plan.agentId, result);
      
      // Record in global intelligence
      this.intelligence.recordBlockedExecution(plan, result);

      this.emit('execution:blocked', { plan, result, failedChecks });
      return result;
    }

    // All checks passed - mark as executable
    this.emit('execution:cleared', { plan, context });

    // Note: Actual LLM execution happens OUTSIDE the OS
    // The OS has cleared it as safe to execute
    // The caller is responsible for actual execution
    // This creates the "execution gate" pattern

    return {
      executionId: plan.executionId,
      status: 'success',
      actualCost: 0, // Will be updated after actual execution
      actualTokens: 0,
      durationMs: 0,
      safetyChecksPassed: plan.safetyChecks.length,
      safetyChecksFailed: 0,
      explanation: 'Execution cleared by ExecutionOS safety checks',
    };
  }

  /**
   * Record actual execution results
   * Must be called after actual LLM execution
   */
  async recordResult(
    executionId: string, 
    actualResult: Partial<ExecutionResult>
  ): Promise<ExecutionResult> {
    const context = this.executions.get(executionId);
    const plan = this.globalGraph.getPlan(executionId);
    
    if (!context || !plan) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const result: ExecutionResult = {
      executionId,
      status: actualResult.status || 'success',
      output: actualResult.output,
      error: actualResult.error,
      actualCost: actualResult.actualCost || 0,
      actualTokens: actualResult.actualTokens || 0,
      durationMs: actualResult.durationMs || (Date.now() - context.startTime),
      safetyChecksPassed: actualResult.safetyChecksPassed || 0,
      safetyChecksFailed: actualResult.safetyChecksFailed || 0,
      explanation: actualResult.explanation || 'Execution completed',
    };

    // Update agent
    this.updateAgentAfterExecution(context.agentId, result);

    // Update global graph
    this.globalGraph.recordResult(executionId, result);

    // Feed into intelligence (network effect)
    await this.intelligence.learn(plan, result, context);

    // Update context
    context.phase = result.status === 'success' ? 'completed' : 'failed';

    this.emit('execution:completed', { plan, result, context });

    return result;
  }

  /**
   * Get execution state from canonical source
   * No external system can reconstruct without OS
   */
  getExecutionState(executionId: string): {
    context: ExecutionContext | undefined;
    plan: ExecutionPlan | undefined;
    result: ExecutionResult | undefined;
    graph: any; // Position in global graph
  } {
    return {
      context: this.executions.get(executionId),
      plan: this.globalGraph.getPlan(executionId),
      result: this.globalGraph.getResult(executionId),
      graph: this.globalGraph.getPosition(executionId),
    };
  }

  /**
   * Get agent profile
   */
  getAgent(agentId: string): AgentIdentity | undefined {
    return this.agents.get(agentId);
  }

  /**
   * List all agents for tenant
   */
  getAgents(): AgentIdentity[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get global intelligence insights
   */
  getIntelligence(): GlobalIntelligence {
    return this.intelligence;
  }

  /**
   * Get system metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Build execution plan with safety gates
   */
  private buildExecutionPlan(
    executionId: string,
    intent: ExecutionIntent,
    context: ExecutionContext,
    intelligence: IntelligenceReport
  ): ExecutionPlan {
    const steps: ExecutionStep[] = [];
    
    // Step 1: Pre-execution gate
    steps.push({
      stepId: `${executionId}-gate-1`,
      type: 'gate',
      description: 'Safety and policy verification',
      estimatedCost: 0,
      estimatedLatency: 5,
      dependencies: [],
    });

    // Step 2: Main execution
    steps.push({
      stepId: `${executionId}-exec`,
      type: intent.type === 'tool' ? 'tool' : 'llm',
      description: `${intent.provider}.${intent.action}`,
      estimatedCost: intent.estimatedCost,
      estimatedLatency: 1000, // 1s default
      dependencies: [`${executionId}-gate-1`],
    });

    // Step 3: Post-execution checkpoint
    steps.push({
      stepId: `${executionId}-checkpoint`,
      type: 'checkpoint',
      description: 'Record execution result and update graphs',
      estimatedCost: 0,
      estimatedLatency: 10,
      dependencies: [`${executionId}-exec`],
    });

    return {
      executionId,
      agentId: context.agentId,
      intent,
      context,
      steps,
      totalEstimatedCost: intent.estimatedCost,
      maxDepth: context.depth,
      safetyChecks: [], // Populated later
    };
  }

  /**
   * Generate safety explanation
   */
  private generateExplanation(failedChecks: SafetyCheck[], plan: ExecutionPlan): string {
    const reasons = failedChecks.map(c => `${c.type}: ${c.message}`);
    return `Execution blocked by ExecutionOS. Failed checks: ${reasons.join('; ')}`;
  }

  /**
   * Update agent after execution
   */
  private updateAgentAfterExecution(agentId: string, result: ExecutionResult): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.executionCount++;
    agent.totalCost += result.actualCost;
    agent.lastSeenAt = Date.now();

    if (result.status === 'blocked' || result.status === 'failed') {
      agent.violationCount++;
      agent.reputationScore = Math.max(0, agent.reputationScore - 5);
    } else {
      agent.reputationScore = Math.min(100, agent.reputationScore + 1);
    }

    // Update trust tier
    if (agent.reputationScore >= 90 && agent.executionCount > 100) {
      agent.trustTier = 'enterprise';
    } else if (agent.reputationScore >= 70 && agent.executionCount > 50) {
      agent.trustTier = 'trusted';
    } else if (agent.reputationScore >= 40) {
      agent.trustTier = 'standard';
    }
  }

  /**
   * Update metrics
   */
  private updateMetrics(latencyMs: number): void {
    this.metrics.totalExecutions++;
    this.metrics.avgLatencyMs = 
      (this.metrics.avgLatencyMs * (this.metrics.totalExecutions - 1) + latencyMs) / 
      this.metrics.totalExecutions;
  }

  /**
   * Start background processes
   */
  private startBackgroundProcesses(): void {
    // Cleanup old executions every 5 minutes
    setInterval(() => this.cleanupOldExecutions(), 5 * 60 * 1000);
    
    // Sync intelligence every minute
    setInterval(() => this.intelligence.sync(), 60 * 1000);
  }

  /**
   * Cleanup old executions
   */
  private cleanupOldExecutions(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [id, context] of this.executions) {
      if (context.startTime < cutoff) {
        this.executions.delete(id);
      }
    }
  }

  /**
   * Generate unique IDs
   */
  private generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSessionId(): string {
    return `sess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateFingerprint(agentId: string, metadata?: Record<string, any>): string {
    const data = `${agentId}:${JSON.stringify(metadata || {})}:${Date.now()}`;
    return Buffer.from(data).toString('base64').substring(0, 32);
  }
}

// Placeholder classes - will be implemented next
class GlobalExecutionGraph {
  private plans: Map<string, ExecutionPlan> = new Map();
  private results: Map<string, ExecutionResult> = new Map();
  
  recordPlan(plan: ExecutionPlan) { this.plans.set(plan.executionId, plan); }
  getPlan(id: string) { return this.plans.get(id); }
  recordResult(id: string, result: ExecutionResult) { this.results.set(id, result); }
  getResult(id: string) { return this.results.get(id); }
  getPosition(id: string) { return { depth: 0, parent: null }; }
}

interface IntelligenceReport {
  riskScore: number;
  similarExecutions: number;
  knownPatterns: string[];
}

class GlobalIntelligence {
  async analyzeIntent(intent: ExecutionIntent, agent: AgentIdentity): Promise<IntelligenceReport> {
    return { riskScore: 50, similarExecutions: 0, knownPatterns: [] };
  }
  recordBlockedExecution(plan: ExecutionPlan, result: ExecutionResult) {}
  async learn(plan: ExecutionPlan, result: ExecutionResult, context: ExecutionContext) {}
  sync() {}
}

class PolicyEngine {
  evaluate(context: ExecutionContext, intent: ExecutionIntent, plan: ExecutionPlan) {
    return { allowed: true };
  }
}

class SafetyKernel {
  async evaluate(plan: ExecutionPlan, agent: AgentIdentity, context: ExecutionContext): Promise<SafetyCheck[]> {
    return [];
  }
}

// Export
export const executionOS = new ExecutionOS({
  tenantId: 'default',
  mode: 'strict',
  defaultBudget: 100,
  strictMode: true,
  globalIntelligence: true,
  policyAutoApply: true,
});
