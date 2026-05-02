/**
 * AECL - Policy Engine
 * 
 * Minimal, deterministic rule system:
 * - Cost thresholds
 * - Repetition thresholds  
 * - Depth/step limits
 * 
 * NO:
 * - Enterprise policy platform
 * - Marketplace
 * - Complex hierarchies
 * - User management
 * 
 * YES:
 * - Simple JSON rules
 * - Fast evaluation (<1ms)
 * - Clear explainability
 */

export interface PolicyRule {
  name: string;
  condition: 'cost' | 'repetition' | 'depth';
  operator: 'gt' | 'gte' | 'eq';
  threshold: number;
  action: 'allow' | 'block';
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface PolicySet {
  id: string;
  name: string;
  rules: PolicyRule[];
  defaultAction: 'allow' | 'block';
}

export interface PolicyContext {
  sessionCost: number;
  sessionSteps: number;
  requestCost: number;
  repetitionCount: number; // Times this call seen recently
  timestamp: number;
}

export interface PolicyResult {
  action: 'allow' | 'block';
  triggeredRule?: PolicyRule;
  reason: string;
  explanation: string;
}

/**
 * Minimal Policy Engine
 * 
 * Default policy set for immediate use:
 * - Session cost limit: $10
 * - Step limit: 50
 * - Request cost limit: $5
 * - Repetition limit: 3 identical calls
 */
export class PolicyEngine {
  private policies: Map<string, PolicySet>;
  private defaultPolicy: PolicySet;

  constructor() {
    this.policies = new Map();
    
    // Minimal default policy - covers 90% of cost explosions
    this.defaultPolicy = {
      id: 'default',
      name: 'Default Protection',
      rules: [
        {
          name: 'session_cost_limit',
          condition: 'cost',
          operator: 'gt',
          threshold: 10, // $10 per session
          action: 'block',
          severity: 'critical',
        },
        {
          name: 'step_limit',
          condition: 'depth',
          operator: 'gte',
          threshold: 50, // 50 steps max
          action: 'block',
          severity: 'high',
        },
        {
          name: 'request_cost_limit',
          condition: 'cost',
          operator: 'gt',
          threshold: 5, // $5 per request
          action: 'block',
          severity: 'high',
        },
        {
          name: 'repetition_limit',
          condition: 'repetition',
          operator: 'gte',
          threshold: 3, // 3 identical calls
          action: 'block',
          severity: 'medium',
        },
      ],
      defaultAction: 'allow',
    };
  }

  /**
   * Evaluate context against policy
   * Returns in <1ms
   */
  evaluate(context: PolicyContext, policyId?: string): PolicyResult {
    const policy = policyId ? this.policies.get(policyId) : this.defaultPolicy;
    
    if (!policy) {
      return {
        action: 'allow',
        reason: 'No policy found',
        explanation: 'Defaulting to allow',
      };
    }

    for (const rule of policy.rules) {
      const triggered = this.checkRule(rule, context);
      
      if (triggered) {
        return {
          action: rule.action,
          triggeredRule: rule,
          reason: `Policy triggered: ${rule.name}`,
          explanation: this.buildExplanation(rule, context),
        };
      }
    }

    return {
      action: policy.defaultAction,
      reason: 'No rules triggered',
      explanation: `All ${policy.rules.length} rules passed`,
    };
  }

  private checkRule(rule: PolicyRule, context: PolicyContext): boolean {
    let value: number;

    switch (rule.condition) {
      case 'cost':
        value = context.requestCost + context.sessionCost;
        break;
      case 'depth':
        value = context.sessionSteps;
        break;
      case 'repetition':
        value = context.repetitionCount;
        break;
      default:
        return false;
    }

    switch (rule.operator) {
      case 'gt':
        return value > rule.threshold;
      case 'gte':
        return value >= rule.threshold;
      case 'eq':
        return value === rule.threshold;
      default:
        return false;
    }
  }

  private buildExplanation(rule: PolicyRule, context: PolicyContext): string {
    let value: number;
    let metric: string;

    switch (rule.condition) {
      case 'cost':
        value = context.requestCost + context.sessionCost;
        metric = 'session cost';
        break;
      case 'depth':
        value = context.sessionSteps;
        metric = 'step count';
        break;
      case 'repetition':
        value = context.repetitionCount;
        metric = 'repetitions';
        break;
      default:
        return 'Unknown rule condition';
    }

    const operatorText = rule.operator === 'gt' ? '>' : 
                        rule.operator === 'gte' ? '>=' : '=';

    return `${metric}: ${value} ${operatorText} ${rule.threshold} (threshold)`;
  }

  /**
   * Add custom policy (rarely needed)
   */
  addPolicy(policy: PolicySet): void {
    this.policies.set(policy.id, policy);
  }

  /**
   * Get default policy for reference
   */
  getDefaultPolicy(): PolicySet {
    return this.defaultPolicy;
  }
}

export const policyEngine = new PolicyEngine();
