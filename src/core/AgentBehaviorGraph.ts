/**
 * AgentBehaviorGraph.ts - AI Agent Behavior Graph Engine
 * 
 * Tracks multi-step agent workflows (not single requests)
 * Builds a state graph of agent actions
 * Detects: loops, redundant tool calls, runaway branching, retry storms
 */

export type AgentActionType = 'llm_call' | 'tool_call' | 'agent_step' | 'reflection' | 'planning';

export interface AgentAction {
  id: string;
  sessionId: string;
  workflowId: string;
  tenantId: string;
  timestamp: number;
  type: AgentActionType;
  provider: string;
  model?: string;
  toolName?: string;
  prompt?: string;
  input: string;
  output?: string;
  tokensUsed: number;
  cost: number;
  parentActionId?: string;
  childActionIds: string[];
  metadata: {
    intent?: string;
    toolResults?: any[];
    error?: string;
    retryCount?: number;
  };
}

export interface WorkflowState {
  id: string;
  sessionId: string;
  tenantId: string;
  startTime: number;
  lastActionTime: number;
  actionCount: number;
  totalCost: number;
  totalTokens: number;
  currentDepth: number;
  maxDepth: number;
  actions: Map<string, AgentAction>;
  rootActionId?: string;
  currentActionId?: string;
  isComplete: boolean;
}

export interface LoopDetectionResult {
  detected: boolean;
  loopType: 'exact' | 'semantic' | 'structural' | 'none';
  loopActions: string[];
  loopCount: number;
  confidence: number;
  similarity: number;
}

export interface RedundancyResult {
  score: number; // 0-1, >0.8 is concerning
  redundantActions: string[];
  reason: string;
}

export interface BranchAnalysis {
  totalBranches: number;
  maxDepth: number;
  isRunaway: boolean;
  branchFactor: number;
}

export interface RetryAnalysis {
  retryCount: number;
  maxRetries: number;
  isRetryStorm: boolean;
  backoffPattern: 'linear' | 'exponential' | 'none';
}

export interface BehaviorAnalysis {
  workflowId: string;
  sessionId: string;
  loop: LoopDetectionResult;
  redundancy: RedundancyResult;
  branching: BranchAnalysis;
  retry: RetryAnalysis;
  totalCost: number;
  predictedTotalCost: number;
  totalRequests: number; // Total actions/requests in workflow
  riskScore: number; // 0-100
  recommendations: string[];
}

/**
 * Agent Behavior Graph Engine
 * 
 * Design:
 * - Maintains in-memory graph state for active workflows
 * - Detects patterns across multi-step agent execution
 * - Stateless persistence for historical analysis
 */
export class AgentBehaviorGraph {
  private activeWorkflows: Map<string, WorkflowState>;
  private actionHistory: Map<string, AgentAction[]>; // Session -> Actions
  private maxWorkflowAgeMs: number = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.activeWorkflows = new Map();
    this.actionHistory = new Map();
    
    // Cleanup old workflows periodically
    setInterval(() => this.cleanupOldWorkflows(), 60 * 1000);
  }

  /**
   * Register a new action in the behavior graph
   */
  recordAction(action: Omit<AgentAction, 'id' | 'timestamp'>): AgentAction {
    const fullAction: AgentAction = {
      ...action,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    // Get or create workflow
    let workflow = this.activeWorkflows.get(action.workflowId);
    if (!workflow) {
      workflow = this.createWorkflow(action.workflowId, action.sessionId, action.tenantId);
    }

    // Link to parent if exists
    if (workflow.currentActionId) {
      fullAction.parentActionId = workflow.currentActionId;
      const parent = workflow.actions.get(workflow.currentActionId);
      if (parent) {
        parent.childActionIds.push(fullAction.id);
      }
    }

    // Update workflow state
    workflow.actions.set(fullAction.id, fullAction);
    workflow.currentActionId = fullAction.id;
    workflow.actionCount++;
    workflow.totalCost += action.cost;
    workflow.totalTokens += action.tokensUsed;
    workflow.lastActionTime = fullAction.timestamp;
    workflow.currentDepth = this.calculateDepth(workflow, fullAction.id);
    workflow.maxDepth = Math.max(workflow.maxDepth, workflow.currentDepth);

    // Store in history
    const history = this.actionHistory.get(action.sessionId) || [];
    history.push(fullAction);
    this.actionHistory.set(action.sessionId, history);

    return fullAction;
  }

  /**
   * Analyze workflow for behavioral patterns
   */
  analyzeWorkflow(workflowId: string): BehaviorAnalysis | null {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) return null;

    const loop = this.detectLoop(workflow);
    const redundancy = this.analyzeRedundancy(workflow);
    const branching = this.analyzeBranching(workflow);
    const retry = this.analyzeRetries(workflow);

    // Calculate risk score
    let riskScore = 0;
    if (loop.detected) riskScore += 40;
    if (redundancy.score > 0.8) riskScore += 30;
    if (branching.isRunaway) riskScore += 20;
    if (retry.isRetryStorm) riskScore += 10;

    // Predict total cost
    const predictedTotalCost = this.predictTotalCost(workflow, riskScore);

    // Generate recommendations
    const recommendations: string[] = [];
    if (loop.detected) {
      recommendations.push(`Loop detected (${loop.loopType}): Consider breaking after ${loop.loopCount} iterations`);
    }
    if (redundancy.score > 0.8) {
      recommendations.push('High redundancy: Cache or deduplicate similar calls');
    }
    if (branching.isRunaway) {
      recommendations.push('Runaway branching: Limit exploration depth or breadth');
    }
    if (retry.isRetryStorm) {
      recommendations.push('Retry storm detected: Implement exponential backoff with jitter');
    }

    return {
      workflowId,
      sessionId: workflow.sessionId,
      loop,
      redundancy,
      branching,
      retry,
      totalCost: workflow.totalCost,
      predictedTotalCost,
      totalRequests: workflow.actionCount,
      riskScore,
      recommendations,
    };
  }

  /**
   * Detect loops in workflow
   * Types: exact (same input), semantic (similar intent), structural (same pattern)
   */
  private detectLoop(workflow: WorkflowState): LoopDetectionResult {
    const actions = Array.from(workflow.actions.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    if (actions.length < 3) {
      return { detected: false, loopType: 'none', loopActions: [], loopCount: 0, confidence: 0, similarity: 0 };
    }

    // Check for exact loops (same input/output)
    for (let i = actions.length - 1; i >= Math.max(0, actions.length - 10); i--) {
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const current = actions[i];
        const previous = actions[j];

        // Exact match
        if (current.input === previous.input && current.type === previous.type) {
          const loopActions = actions.slice(j, i + 1).map(a => a.id);
          return {
            detected: true,
            loopType: 'exact',
            loopActions,
            loopCount: Math.floor((actions.length - j) / (i - j)),
            confidence: 0.95,
            similarity: 1.0,
          };
        }

        // Semantic match (similar intent/prompt)
        const similarity = this.calculateSimilarity(current.input, previous.input);
        if (similarity > 0.85 && current.type === previous.type) {
          const loopActions = actions.slice(j, i + 1).map(a => a.id);
          return {
            detected: true,
            loopType: 'semantic',
            loopActions,
            loopCount: 1,
            confidence: similarity,
            similarity,
          };
        }
      }
    }

    return { detected: false, loopType: 'none', loopActions: [], loopCount: 0, confidence: 0, similarity: 0 };
  }

  /**
   * Analyze redundancy in workflow
   */
  private analyzeRedundancy(workflow: WorkflowState): RedundancyResult {
    const actions = Array.from(workflow.actions.values());
    const toolCalls = actions.filter(a => a.type === 'tool_call');

    if (toolCalls.length < 2) {
      return { score: 0, redundantActions: [], reason: 'Insufficient data' };
    }

    // Group by tool name
    const byTool = new Map<string, AgentAction[]>();
    toolCalls.forEach(action => {
      const key = action.toolName || 'unknown';
      const group = byTool.get(key) || [];
      group.push(action);
      byTool.set(key, group);
    });

    let redundantCount = 0;
    const redundantActions: string[] = [];

    // Check for redundant calls to same tool with similar inputs
    for (const [toolName, calls] of byTool) {
      for (let i = 0; i < calls.length; i++) {
        for (let j = i + 1; j < calls.length; j++) {
          const similarity = this.calculateSimilarity(calls[i].input, calls[j].input);
          if (similarity > 0.8) {
            redundantCount++;
            redundantActions.push(calls[i].id, calls[j].id);
          }
        }
      }
    }

    const score = redundantCount / toolCalls.length;

    return {
      score,
      redundantActions: [...new Set(redundantActions)],
      reason: score > 0.5 ? 'High redundancy detected' : 'Low redundancy',
    };
  }

  /**
   * Analyze branching in workflow
   */
  private analyzeBranching(workflow: WorkflowState): BranchAnalysis {
    const actions = Array.from(workflow.actions.values());
    
    // Calculate branch factor (average children per action)
    let totalChildren = 0;
    actions.forEach(action => {
      totalChildren += action.childActionIds.length;
    });
    
    const branchFactor = actions.length > 0 ? totalChildren / actions.length : 0;
    const isRunaway = branchFactor > 3 || workflow.maxDepth > 10;

    return {
      totalBranches: totalChildren,
      maxDepth: workflow.maxDepth,
      isRunaway,
      branchFactor,
    };
  }

  /**
   * Analyze retry patterns
   */
  private analyzeRetries(workflow: WorkflowState): RetryAnalysis {
    const actions = Array.from(workflow.actions.values());
    
    let retryCount = 0;
    let maxRetries = 0;
    
    actions.forEach(action => {
      if (action.metadata.retryCount) {
        retryCount += action.metadata.retryCount;
        maxRetries = Math.max(maxRetries, action.metadata.retryCount);
      }
    });

    const isRetryStorm = maxRetries > 5 || (retryCount / actions.length) > 0.3;

    return {
      retryCount,
      maxRetries,
      isRetryStorm,
      backoffPattern: 'none', // Could be enhanced with actual pattern analysis
    };
  }

  /**
   * Predict total cost based on current trajectory
   */
  private predictTotalCost(workflow: WorkflowState, riskScore: number): number {
    const currentCost = workflow.totalCost;
    const actionCount = workflow.actionCount;
    
    // Simple prediction: if risk is high, assume 3x current cost
    // If risk is low, assume 1.5x current cost
    const multiplier = riskScore > 50 ? 3 : 1.5;
    
    return currentCost * multiplier;
  }

  /**
   * Calculate similarity between two strings (0-1)
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    // Simple Jaccard similarity on words
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return intersection.size / union.size;
  }

  /**
   * Calculate depth of action in workflow tree
   */
  private calculateDepth(workflow: WorkflowState, actionId: string): number {
    let depth = 0;
    let currentId: string | undefined = actionId;
    
    while (currentId) {
      const action = workflow.actions.get(currentId);
      if (!action || !action.parentActionId) break;
      depth++;
      currentId = action.parentActionId;
    }
    
    return depth;
  }

  /**
   * Create new workflow state
   */
  private createWorkflow(id: string, sessionId: string, tenantId: string): WorkflowState {
    const workflow: WorkflowState = {
      id,
      sessionId,
      tenantId,
      startTime: Date.now(),
      lastActionTime: Date.now(),
      actionCount: 0,
      totalCost: 0,
      totalTokens: 0,
      currentDepth: 0,
      maxDepth: 0,
      actions: new Map(),
      isComplete: false,
    };
    
    this.activeWorkflows.set(id, workflow);
    return workflow;
  }

  /**
   * Cleanup old workflows
   */
  private cleanupOldWorkflows(): void {
    const now = Date.now();
    for (const [id, workflow] of this.activeWorkflows) {
      if (now - workflow.lastActionTime > this.maxWorkflowAgeMs) {
        this.activeWorkflows.delete(id);
      }
    }
  }

  /**
   * Get workflow state
   */
  getWorkflow(workflowId: string): WorkflowState | undefined {
    return this.activeWorkflows.get(workflowId);
  }

  /**
   * Complete workflow
   */
  completeWorkflow(workflowId: string): void {
    const workflow = this.activeWorkflows.get(workflowId);
    if (workflow) {
      workflow.isComplete = true;
    }
  }

  /**
   * Get session actions
   */
  getSessionActions(sessionId: string): AgentAction[] {
    return this.actionHistory.get(sessionId) || [];
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton
export const agentBehaviorGraph = new AgentBehaviorGraph();
