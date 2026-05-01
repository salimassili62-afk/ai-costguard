import { ConfigManager, BudgetConfig, ScopedPolicyConfig, TrustMode } from '../config';
import { stateStore } from './StateStore';
import { FirewallMetadata, TokenBreakdown } from './types';

export interface EffectivePolicy {
  id: string;
  trustMode: TrustMode;
  budgets: BudgetConfig;
  matchedPolicies: string[];
}

export interface PolicyEvaluationInput {
  estimatedCost: number;
  model: string;
  metadata?: FirewallMetadata;
  tokens?: TokenBreakdown;
}

export interface PolicyEvaluationResult {
  decision: 'allow' | 'warn' | 'block';
  dangerScore: number;
  category: 'budget' | 'metadata' | 'safe';
  reason: string;
  effectivePolicy: EffectivePolicy;
}

export interface BudgetStatus {
  policyId: string;
  scope: Partial<FirewallMetadata>;
  dailyBudget: number;
  dailySpend: number;
  monthlyBudget: number;
  monthlySpend: number;
  workflowBudget?: number;
  workflowSpend?: number;
  percentDailyUsed: number;
  percentMonthlyUsed: number;
}

export class PolicyEngine {
  private static instance: PolicyEngine;

  static getInstance(): PolicyEngine {
    if (!PolicyEngine.instance) {
      PolicyEngine.instance = new PolicyEngine();
    }
    return PolicyEngine.instance;
  }

  evaluate(input: PolicyEvaluationInput): PolicyEvaluationResult {
    const policy = this.getEffectivePolicy(input.metadata);

    if (input.estimatedCost > policy.budgets.perRequestUsd) {
      return {
        decision: 'block',
        dangerScore: 100,
        category: 'budget',
        reason: `PER-REQUEST BUDGET EXCEEDED: $${input.estimatedCost.toFixed(4)} > $${policy.budgets.perRequestUsd.toFixed(2)}`,
        effectivePolicy: policy,
      };
    }

    const totalTokens =
      input.tokens?.totalTokens ?? (input.tokens?.inputTokens || 0) + (input.tokens?.outputTokens || 0);
    if (policy.budgets.tokensPerRequest && totalTokens > policy.budgets.tokensPerRequest) {
      return {
        decision: 'block',
        dangerScore: 95,
        category: 'budget',
        reason: `TOKEN BUDGET EXCEEDED: ${totalTokens} tokens > ${policy.budgets.tokensPerRequest}`,
        effectivePolicy: policy,
      };
    }

    const status = this.getBudgetStatus(input.metadata);
    if (status.dailySpend + input.estimatedCost > status.dailyBudget) {
      return {
        decision: 'block',
        dangerScore: 85,
        category: 'budget',
        reason: `DAILY BUDGET EXCEEDED: $${(status.dailySpend + input.estimatedCost).toFixed(2)} > $${status.dailyBudget.toFixed(2)}`,
        effectivePolicy: policy,
      };
    }

    if (status.monthlySpend + input.estimatedCost > status.monthlyBudget) {
      return {
        decision: 'block',
        dangerScore: 88,
        category: 'budget',
        reason: `MONTHLY BUDGET EXCEEDED: $${(status.monthlySpend + input.estimatedCost).toFixed(2)} > $${status.monthlyBudget.toFixed(2)}`,
        effectivePolicy: policy,
      };
    }

    if (
      status.workflowBudget !== undefined &&
      status.workflowSpend !== undefined &&
      status.workflowSpend + input.estimatedCost > status.workflowBudget
    ) {
      return {
        decision: 'block',
        dangerScore: 82,
        category: 'budget',
        reason: `WORKFLOW BUDGET EXCEEDED: $${(status.workflowSpend + input.estimatedCost).toFixed(2)} > $${status.workflowBudget.toFixed(2)}`,
        effectivePolicy: policy,
      };
    }

    if (status.percentDailyUsed >= 80 || status.percentMonthlyUsed >= 80) {
      return {
        decision: 'warn',
        dangerScore: 45,
        category: 'budget',
        reason: `BUDGET WARNING: daily ${status.percentDailyUsed.toFixed(1)}%, monthly ${status.percentMonthlyUsed.toFixed(1)}% used`,
        effectivePolicy: policy,
      };
    }

    return {
      decision: 'allow',
      dangerScore: 0,
      category: 'safe',
      reason: 'Policy checks passed',
      effectivePolicy: policy,
    };
  }

  getBudgetStatus(metadata: FirewallMetadata = {}): BudgetStatus {
    const policy = this.getEffectivePolicy(metadata);
    const dayMs = 24 * 60 * 60 * 1000;
    const monthMs = 30 * dayMs;
    const scope = this.getStatsScope(metadata, policy);
    const daily = stateStore.getFilteredStats({
      windowMs: dayMs,
      metadata: scope,
      includeBlocked: false,
    });
    const monthly = stateStore.getFilteredStats({
      windowMs: monthMs,
      metadata: scope,
      includeBlocked: false,
    });

    const workflowScope = metadata.workflowId ? { ...scope, workflowId: metadata.workflowId } : undefined;
    const workflow = workflowScope
      ? stateStore.getFilteredStats({
          windowMs: monthMs,
          metadata: workflowScope,
          includeBlocked: false,
        })
      : undefined;

    return {
      policyId: policy.id,
      scope,
      dailyBudget: policy.budgets.dailyUsd,
      dailySpend: daily.actualCost,
      monthlyBudget: policy.budgets.monthlyUsd,
      monthlySpend: monthly.actualCost,
      workflowBudget: policy.budgets.workflowUsd,
      workflowSpend: workflow?.actualCost,
      percentDailyUsed: policy.budgets.dailyUsd > 0 ? (daily.actualCost / policy.budgets.dailyUsd) * 100 : 0,
      percentMonthlyUsed: policy.budgets.monthlyUsd > 0 ? (monthly.actualCost / policy.budgets.monthlyUsd) * 100 : 0,
    };
  }

  getEffectivePolicy(metadata: FirewallMetadata = {}): EffectivePolicy {
    const config = new ConfigManager().getConfig();
    const matched = config.policies
      .filter((policy) => this.matchesScope(policy, metadata))
      .sort((a, b) => this.scopeSpecificity(a) - this.scopeSpecificity(b));

    const budgets: BudgetConfig = { ...config.budgets };
    let trustMode = config.trustMode;

    for (const policy of matched) {
      Object.assign(budgets, policy.budgets || {});
      if (policy.trustMode) {
        trustMode = policy.trustMode;
      }
    }

    return {
      id: matched.length > 0 ? matched[matched.length - 1].id : 'default',
      trustMode,
      budgets,
      matchedPolicies: matched.map((policy) => policy.id),
    };
  }

  private matchesScope(policy: ScopedPolicyConfig, metadata: FirewallMetadata): boolean {
    return Object.entries(policy.scope).every(([key, value]) => {
      if (value === undefined) return true;
      if (key === 'model') return metadata.model === value;
      return metadata[key] === value;
    });
  }

  private scopeSpecificity(policy: ScopedPolicyConfig): number {
    return Object.values(policy.scope).filter((value) => value !== undefined).length;
  }

  private getStatsScope(metadata: FirewallMetadata, policy: EffectivePolicy): Partial<FirewallMetadata> {
    const scope: Partial<FirewallMetadata> = {};
    const fields: Array<keyof FirewallMetadata> = [
      'orgId',
      'teamId',
      'appId',
      'userId',
      'sessionId',
      'agentId',
      'apiKeyId',
    ];

    for (const field of fields) {
      if (metadata[field] !== undefined) {
        scope[field] = metadata[field] as string;
      }
    }

    if (Object.keys(scope).length === 0 && policy.id !== 'default') {
      const config = new ConfigManager().getConfig();
      const matched = config.policies.find((candidate) => candidate.id === policy.id);
      return { ...(matched?.scope || {}) };
    }

    return scope;
  }
}

export const policyEngine = PolicyEngine.getInstance();
