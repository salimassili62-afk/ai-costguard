/**
 * PolicyEngine.ts - Hierarchical Policy Engine
 * 
 * Enterprise-grade policy system:
 * - Tenant-level policies
 * - Team-level policies  
 * - User-level policies
 * - Workflow-level policies
 * 
 * Rule types:
 * - max cost per workflow
 * - max tool-call depth
 * - semantic repetition threshold
 * - warn → throttle → block modes
 */

import { EventEmitter } from 'events';

export type PolicyLevel = 'tenant' | 'team' | 'user' | 'workflow';
export type EnforcementMode = 'monitor' | 'warn' | 'throttle' | 'block';
export type PolicyAction = 'allow' | 'warn' | 'throttle' | 'block';

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number; // Higher = evaluated first
  condition: PolicyCondition;
  action: PolicyAction;
  throttleParams?: {
    delayMs: number;
    rateLimitPerMinute?: number;
  };
}

export interface PolicyCondition {
  type: 'cost_threshold' | 'depth_limit' | 'repetition_score' | 'loop_detected' | 
        'token_limit' | 'time_window' | 'custom';
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'contains' | 'regex';
  threshold: number | string | boolean;
  // For time-based conditions
  windowMs?: number;
  // For composite conditions
  and?: PolicyCondition[];
  or?: PolicyCondition[];
}

export interface PolicySet {
  id: string;
  tenantId: string;
  level: PolicyLevel;
  targetId: string; // teamId, userId, or workflowId
  rules: PolicyRule[];
  defaultAction: PolicyAction;
  maxCostPerWorkflow: number;
  maxDepth: number;
  maxTokensPerRequest: number;
  repetitionThreshold: number; // 0-1 similarity score
  createdAt: number;
  updatedAt: number;
}

export interface PolicyEvaluationContext {
  tenantId: string;
  teamId?: string;
  userId?: string;
  workflowId?: string;
  sessionId: string;
  requestId: string;
  currentCost: number;
  currentDepth: number;
  currentTokens: number;
  repetitionScore: number;
  loopDetected: boolean;
  actionType: string;
  timestamp: number;
}

export interface PolicyEvaluationResult {
  action: PolicyAction;
  reason: string;
  confidence: number;
  rulesTriggered: PolicyRule[];
  policyChain: Array<{
    level: PolicyLevel;
    policyId: string;
    action: PolicyAction;
  }>;
  throttleParams?: {
    delayMs: number;
    rateLimitPerMinute?: number;
  };
}

export interface PolicyViolation {
  rule: PolicyRule;
  context: PolicyEvaluationContext;
  actualValue: any;
  expectedValue: any;
  timestamp: number;
}

/**
 * Policy Engine
 * 
 * Evaluates hierarchical policies in order:
 * 1. Tenant-level (most restrictive applies)
 * 2. Team-level
 * 3. User-level
 * 4. Workflow-level (most specific)
 * 
 * Action precedence: block > throttle > warn > allow
 */
export class PolicyEngine extends EventEmitter {
  private policies: Map<string, PolicySet>; // tenantId -> PolicySet
  private tenantPolicies: Map<string, PolicySet[]>; // tenantId -> all level policies
  private violationHistory: Map<string, PolicyViolation[]>; // tenantId -> violations
  private maxViolationsPerTenant: number = 1000;

  constructor() {
    super();
    this.policies = new Map();
    this.tenantPolicies = new Map();
    this.violationHistory = new Map();
  }

  /**
   * Register a policy set
   */
  registerPolicy(policySet: PolicySet): void {
    const key = `${policySet.tenantId}:${policySet.level}:${policySet.targetId}`;
    this.policies.set(key, policySet);

    // Update tenant policies list
    const tenantPols = this.tenantPolicies.get(policySet.tenantId) || [];
    const existingIndex = tenantPols.findIndex(
      p => p.level === policySet.level && p.targetId === policySet.targetId
    );
    
    if (existingIndex >= 0) {
      tenantPols[existingIndex] = policySet;
    } else {
      tenantPols.push(policySet);
    }
    
    this.tenantPolicies.set(policySet.tenantId, tenantPols);
    
    this.emit('policy:registered', policySet);
  }

  /**
   * Evaluate policies for a request
   * Returns the most restrictive action across all policy levels
   */
  evaluate(context: PolicyEvaluationContext): PolicyEvaluationResult {
    const policyChain: Array<{ level: PolicyLevel; policyId: string; action: PolicyAction }> = [];
    const rulesTriggered: PolicyRule[] = [];
    let finalAction: PolicyAction = 'allow';
    let finalReason = 'No policies violated';
    let finalThrottleParams: { delayMs: number; rateLimitPerMinute?: number } | undefined;

    // Get policies for all levels
    const policies = this.getPoliciesForContext(context);

    // Evaluate from tenant (least specific) to workflow (most specific)
    const levels: PolicyLevel[] = ['tenant', 'team', 'user', 'workflow'];
    
    for (const level of levels) {
      const levelPolicies = policies.filter(p => p.level === level);
      
      for (const policy of levelPolicies) {
        // Evaluate each rule in priority order
        const sortedRules = [...policy.rules].sort((a, b) => b.priority - a.priority);
        
        for (const rule of sortedRules) {
          if (!rule.enabled) continue;

          const triggered = this.evaluateCondition(rule.condition, context);
          
          if (triggered) {
            rulesTriggered.push(rule);
            policyChain.push({
              level,
              policyId: policy.id,
              action: rule.action,
            });

            // Record violation
            this.recordViolation(rule, context);

            // Apply most restrictive action
            if (this.actionPrecedence(rule.action) > this.actionPrecedence(finalAction)) {
              finalAction = rule.action;
              finalReason = `Policy rule "${rule.name}" triggered at ${level} level`;
              finalThrottleParams = rule.throttleParams;
            }

            // If block, no need to continue evaluating
            if (finalAction === 'block') {
              break;
            }
          }
        }

        if (finalAction === 'block') break;
      }

      if (finalAction === 'block') break;
    }

    // Apply default tenant policy if no rules triggered
    if (finalAction === 'allow' && policies.length > 0) {
      const tenantPolicy = policies.find(p => p.level === 'tenant');
      if (tenantPolicy && tenantPolicy.defaultAction !== 'allow') {
        finalAction = tenantPolicy.defaultAction;
        finalReason = 'Default tenant policy applied';
      }
    }

    return {
      action: finalAction,
      reason: finalReason,
      confidence: rulesTriggered.length > 0 ? 0.9 : 1.0,
      rulesTriggered,
      policyChain,
      throttleParams: finalThrottleParams,
    };
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: PolicyCondition, context: PolicyEvaluationContext): boolean {
    // Handle composite conditions
    if (condition.and) {
      return condition.and.every(c => this.evaluateCondition(c, context));
    }
    if (condition.or) {
      return condition.or.some(c => this.evaluateCondition(c, context));
    }

    // Get the value to compare based on condition type
    let value: any;
    switch (condition.type) {
      case 'cost_threshold':
        value = context.currentCost;
        break;
      case 'depth_limit':
        value = context.currentDepth;
        break;
      case 'token_limit':
        value = context.currentTokens;
        break;
      case 'repetition_score':
        value = context.repetitionScore;
        break;
      case 'loop_detected':
        value = context.loopDetected;
        break;
      default:
        value = null;
    }

    // Compare based on operator
    switch (condition.operator) {
      case 'gt':
        return value > condition.threshold;
      case 'gte':
        return value >= condition.threshold;
      case 'lt':
        return value < condition.threshold;
      case 'lte':
        return value <= condition.threshold;
      case 'eq':
        return value === condition.threshold;
      case 'contains':
        return String(value).includes(String(condition.threshold));
      default:
        return false;
    }
  }

  /**
   * Get policies relevant to a context
   */
  private getPoliciesForContext(context: PolicyEvaluationContext): PolicySet[] {
    const policies: PolicySet[] = [];
    const tenantPols = this.tenantPolicies.get(context.tenantId) || [];

    for (const policy of tenantPols) {
      // Check if policy applies to this context
      let applies = false;
      
      switch (policy.level) {
        case 'tenant':
          applies = true;
          break;
        case 'team':
          applies = context.teamId === policy.targetId;
          break;
        case 'user':
          applies = context.userId === policy.targetId;
          break;
        case 'workflow':
          applies = context.workflowId === policy.targetId;
          break;
      }

      if (applies) {
        policies.push(policy);
      }
    }

    return policies;
  }

  /**
   * Record a policy violation
   */
  private recordViolation(rule: PolicyRule, context: PolicyEvaluationContext): void {
    const violations = this.violationHistory.get(context.tenantId) || [];
    
    violations.push({
      rule,
      context,
      actualValue: this.getActualValue(rule.condition, context),
      expectedValue: rule.condition.threshold,
      timestamp: Date.now(),
    });

    // Keep only recent violations
    if (violations.length > this.maxViolationsPerTenant) {
      violations.splice(0, violations.length - this.maxViolationsPerTenant);
    }

    this.violationHistory.set(context.tenantId, violations);
    this.emit('policy:violation', { rule, context });
  }

  /**
   * Get actual value for a condition from context
   */
  private getActualValue(condition: PolicyCondition, context: PolicyEvaluationContext): any {
    switch (condition.type) {
      case 'cost_threshold':
        return context.currentCost;
      case 'depth_limit':
        return context.currentDepth;
      case 'token_limit':
        return context.currentTokens;
      case 'repetition_score':
        return context.repetitionScore;
      case 'loop_detected':
        return context.loopDetected;
      default:
        return null;
    }
  }

  /**
   * Action precedence for determining most restrictive
   */
  private actionPrecedence(action: PolicyAction): number {
    const precedence: Record<PolicyAction, number> = {
      allow: 0,
      warn: 1,
      throttle: 2,
      block: 3,
    };
    return precedence[action];
  }

  /**
   * Get violations for a tenant
   */
  getViolations(tenantId: string, limit: number = 100): PolicyViolation[] {
    const violations = this.violationHistory.get(tenantId) || [];
    return violations.slice(-limit);
  }

  /**
   * Create default tenant policy
   */
  createDefaultPolicy(tenantId: string): PolicySet {
    return {
      id: `default-${tenantId}`,
      tenantId,
      level: 'tenant',
      targetId: tenantId,
      rules: [
        {
          id: 'max-cost',
          name: 'Maximum Cost Per Workflow',
          description: 'Block workflows exceeding $10',
          enabled: true,
          priority: 100,
          condition: {
            type: 'cost_threshold',
            operator: 'gt',
            threshold: 10,
          },
          action: 'block',
        },
        {
          id: 'max-depth',
          name: 'Maximum Tool Call Depth',
          description: 'Block workflows exceeding 10 levels deep',
          enabled: true,
          priority: 90,
          condition: {
            type: 'depth_limit',
            operator: 'gt',
            threshold: 10,
          },
          action: 'block',
        },
        {
          id: 'loop-detection',
          name: 'Loop Detection',
          description: 'Block when loops are detected',
          enabled: true,
          priority: 95,
          condition: {
            type: 'loop_detected',
            operator: 'eq',
            threshold: true,
          },
          action: 'block',
        },
        {
          id: 'high-cost-warning',
          name: 'High Cost Warning',
          description: 'Warn when cost exceeds $5',
          enabled: true,
          priority: 50,
          condition: {
            type: 'cost_threshold',
            operator: 'gt',
            threshold: 5,
          },
          action: 'warn',
        },
      ],
      defaultAction: 'allow',
      maxCostPerWorkflow: 10,
      maxDepth: 10,
      maxTokensPerRequest: 100000,
      repetitionThreshold: 0.8,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

// Export singleton
export const policyEngine = new PolicyEngine();
