/**
 * ExplainabilityLayer.ts - Trust Through Transparency
 * 
 * Every blocked request MUST show:
 * - Why it was blocked
 * - Cost prediction breakdown
 * - Policy rule triggered
 * - Confidence score
 * 
 * No black-box decisions allowed.
 */

import { ExecutionDecisionResult, ExecutionExplanation } from './ExecutionInterceptor';
import { PolicyEvaluationResult, PolicyRule } from './PolicyEngine';
import { BehaviorAnalysis } from './AgentBehaviorGraph';
import { CostPrediction, BudgetAnalysis } from './CostPredictionEngine';

export interface ExplanationRequest {
  decision: 'allow' | 'throttle' | 'block';
  requestId: string;
  workflowId: string;
  sessionId: string;
  timestamp: number;
  input: string;
  provider: string;
  model?: string;
}

export interface ExplanationOutput {
  summary: string;
  decision: 'allow' | 'throttle' | 'block';
  confidence: number;
  sections: ExplanationSection[];
  recommendations: string[];
  documentationLinks: string[];
  appealProcess?: {
    available: boolean;
    reason: string;
    contact?: string;
  };
}

export interface ExplanationSection {
  title: string;
  icon: string;
  content: string;
  details?: string[];
  data?: Record<string, any>;
  visual?: 'progress' | 'gauge' | 'timeline' | 'list';
}

export interface CostBreakdownExplanation {
  currentSpend: number;
  predictedTotal: number;
  worstCase: number;
  budgetLimit: number;
  percentageUsed: number;
  items: Array<{
    name: string;
    cost: number;
    percentage: number;
    description: string;
  }>;
}

export interface PolicyExplanation {
  ruleName: string;
  ruleDescription: string;
  threshold: any;
  actualValue: any;
  triggered: boolean;
  severity: 'info' | 'warning' | 'critical';
  policyLevel: string;
}

export interface BehaviorExplanation {
  pattern: string;
  detected: boolean;
  confidence: number;
  details: string;
  similarCases: number;
  historicalAccuracy: number;
}

/**
 * Explainability Layer
 * 
 * Generates human-readable explanations for all decisions.
 * Critical for trust and adoption in enterprise settings.
 */
export class ExplainabilityLayer {
  private documentationBaseUrl: string = 'https://docs.ai-execution-control.com';

  /**
   * Generate comprehensive explanation for a decision
   */
  explain(
    request: ExplanationRequest,
    executionResult: ExecutionDecisionResult,
    behaviorAnalysis?: BehaviorAnalysis,
    costPrediction?: CostPrediction,
    budgetAnalysis?: BudgetAnalysis
  ): ExplanationOutput {
    const sections: ExplanationSection[] = [];
    const recommendations: string[] = [];

    // 1. Decision Summary
    sections.push(this.createDecisionSection(request, executionResult));

    // 2. Cost Breakdown
    if (costPrediction && budgetAnalysis) {
      sections.push(this.createCostSection(costPrediction, budgetAnalysis));
      recommendations.push(...costPrediction.recommendations);
    }

    // 3. Policy Rules
    if (executionResult.policyRulesTriggered.length > 0) {
      sections.push(this.createPolicySection(executionResult));
    }

    // 4. Behavior Analysis
    if (behaviorAnalysis) {
      sections.push(this.createBehaviorSection(behaviorAnalysis));
      recommendations.push(...behaviorAnalysis.recommendations);
    }

    // 5. Confidence & Evidence
    sections.push(this.createConfidenceSection(executionResult, behaviorAnalysis));

    // Build summary
    const summary = this.buildSummary(request, executionResult, behaviorAnalysis, costPrediction);

    return {
      summary,
      decision: request.decision,
      confidence: executionResult.confidence,
      sections,
      recommendations: [...new Set(recommendations)], // dedupe
      documentationLinks: this.getDocumentationLinks(executionResult),
      appealProcess: request.decision === 'block' ? {
        available: true,
        reason: 'You can override this block with explicit approval',
        contact: 'support@ai-execution-control.com',
      } : undefined,
    };
  }

  /**
   * Format explanation for CLI output
   */
  formatForCLI(output: ExplanationOutput): string {
    const lines: string[] = [];

    // Header
    lines.push('');
    lines.push(`🔍 EXECUTION DECISION EXPLANATION`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push('');

    // Decision badge
    const decisionEmoji = output.decision === 'block' ? '🔴' : 
                         output.decision === 'throttle' ? '🟡' : '🟢';
    const decisionText = output.decision.toUpperCase();
    lines.push(`${decisionEmoji} DECISION: ${decisionText}`);
    lines.push(`Confidence: ${Math.round(output.confidence * 100)}%`);
    lines.push('');

    // Sections
    for (const section of output.sections) {
      lines.push(`${section.icon} ${section.title}`);
      lines.push(section.content);
      
      if (section.details) {
        for (const detail of section.details) {
          lines.push(`  • ${detail}`);
        }
      }
      
      if (section.data) {
        for (const [key, value] of Object.entries(section.data)) {
          lines.push(`  ${key}: ${value}`);
        }
      }
      
      lines.push('');
    }

    // Recommendations
    if (output.recommendations.length > 0) {
      lines.push('💡 RECOMMENDATIONS');
      for (const rec of output.recommendations) {
        lines.push(`  → ${rec}`);
      }
      lines.push('');
    }

    // Documentation
    if (output.documentationLinks.length > 0) {
      lines.push('📚 Learn more:');
      for (const link of output.documentationLinks.slice(0, 3)) {
        lines.push(`  ${link}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format explanation for JSON/API response
   */
  formatForAPI(output: ExplanationOutput): Record<string, any> {
    return {
      summary: output.summary,
      decision: output.decision,
      confidence: output.confidence,
      sections: output.sections.map(s => ({
        title: s.title,
        content: s.content,
        details: s.details,
        data: s.data,
      })),
      recommendations: output.recommendations,
      documentation: output.documentationLinks,
      appeal: output.appealProcess,
    };
  }

  /**
   * Format for dashboard/web UI
   */
  formatForDashboard(output: ExplanationOutput): ExplanationOutput {
    // Return as-is, UI components handle rendering
    return output;
  }

  private createDecisionSection(
    request: ExplanationRequest,
    result: ExecutionDecisionResult
  ): ExplanationSection {
    const decisionDescriptions: Record<string, string> = {
      allow: 'Request approved for execution',
      throttle: 'Request approved with rate limiting',
      block: 'Request blocked due to policy violations',
    };

    return {
      title: 'Decision Summary',
      icon: '⚖️',
      content: decisionDescriptions[request.decision],
      details: [
        `Request ID: ${request.requestId}`,
        `Provider: ${request.provider}`,
        `Model: ${request.model || 'N/A'}`,
        `Timestamp: ${new Date(request.timestamp).toISOString()}`,
        `Reason: ${result.reason}`,
      ],
    };
  }

  private createCostSection(
    prediction: CostPrediction,
    budget: BudgetAnalysis
  ): ExplanationSection {
    const usedPercent = Math.round(budget.currentSpend / budget.budgetLimit * 100);
    const predictedPercent = Math.round(prediction.predictedTotal / budget.budgetLimit * 100);

    return {
      title: 'Cost Analysis',
      icon: '💰',
      content: `Budget: $${budget.currentSpend.toFixed(2)} / $${budget.budgetLimit.toFixed(2)} used (${usedPercent}%)`,
      details: [
        `Current spend: $${budget.currentSpend.toFixed(4)}`,
        `Predicted total: $${prediction.predictedTotal.toFixed(4)} (${predictedPercent}% of budget)`,
        `Worst case: $${prediction.worstCase.toFixed(4)}`,
        `Remaining budget: $${budget.remainingBudget.toFixed(4)}`,
        `Will exceed budget: ${budget.willExceed ? 'YES' : 'NO'}`,
      ],
      data: {
        'Risk Level': prediction.riskLevel.toUpperCase(),
        'Confidence': `${Math.round(prediction.confidence * 100)}%`,
        'Burn Rate': `$${budget.burnRate.toFixed(4)}/min`,
      },
      visual: 'progress',
    };
  }

  private createPolicySection(result: ExecutionDecisionResult): ExplanationSection {
    return {
      title: 'Policy Enforcement',
      icon: '📋',
      content: `${result.policyRulesTriggered.length} policy rule(s) triggered`,
      details: result.policyRulesTriggered.map(rule => `Rule: ${rule}`),
      visual: 'list',
    };
  }

  private createBehaviorSection(analysis: BehaviorAnalysis): ExplanationSection {
    const details: string[] = [];

    if (analysis.loop.detected) {
      details.push(`⚠️ Loop detected (${analysis.loop.loopType}): ${analysis.loop.confidence > 0.9 ? 'High confidence' : 'Medium confidence'}`);
    }

    if (analysis.redundancy.score > 0.5) {
      details.push(`⚠️ Redundancy score: ${Math.round(analysis.redundancy.score * 100)}%`);
    }

    if (analysis.branching.isRunaway) {
      details.push(`⚠️ Runaway branching detected (depth: ${analysis.branching.maxDepth})`);
    }

    if (analysis.retry.isRetryStorm) {
      details.push(`⚠️ Retry storm detected (${analysis.retry.retryCount} retries)`);
    }

    return {
      title: 'Behavior Analysis',
      icon: '🧠',
      content: `Workflow step ${analysis.totalCost > 0 ? 'with' : 'without'} anomalous patterns`,
      details: details.length > 0 ? details : ['No anomalous patterns detected'],
      data: {
        'Workflow Steps': analysis.totalRequests || 0,
        'Loop Detected': analysis.loop.detected ? 'YES' : 'NO',
        'Redundancy Score': `${Math.round(analysis.redundancy.score * 100)}%`,
        'Branch Depth': analysis.branching.maxDepth,
        'Risk Score': `${analysis.riskScore}/100`,
      },
      visual: 'gauge',
    };
  }

  private createConfidenceSection(
    result: ExecutionDecisionResult,
    behaviorAnalysis?: BehaviorAnalysis
  ): ExplanationSection {
    const confidencePercent = Math.round(result.confidence * 100);
    const confidenceLevel = confidencePercent >= 90 ? 'Very High' :
                           confidencePercent >= 70 ? 'High' :
                           confidencePercent >= 50 ? 'Medium' : 'Low';

    return {
      title: 'Decision Confidence',
      icon: '🎯',
      content: `Confidence level: ${confidenceLevel} (${confidencePercent}%)`,
      details: [
        `Decision algorithm: Multi-factor analysis`,
        `Data sources: Policy engine, Behavior graph, Cost prediction`,
        `Behavioral data: ${behaviorAnalysis ? 'Available' : 'Not applicable'}`,
      ],
      data: {
        'Confidence': `${confidencePercent}%`,
        'Latency': `${(result.latencyMs ?? 0).toFixed(2)}ms`,
        'Data Quality': behaviorAnalysis ? 'High' : 'Medium',
      },
    };
  }

  private buildSummary(
    request: ExplanationRequest,
    result: ExecutionDecisionResult,
    behaviorAnalysis?: BehaviorAnalysis,
    costPrediction?: CostPrediction
  ): string {
    const parts: string[] = [];

    if (request.decision === 'block') {
      parts.push('Execution blocked.');
    } else if (request.decision === 'throttle') {
      parts.push('Execution allowed with rate limiting.');
    } else {
      parts.push('Execution approved.');
    }

    parts.push(`Reason: ${result.reason}`);

    if (behaviorAnalysis?.loop.detected) {
      parts.push('Behavioral anomaly: Loop detected.');
    }

    if (costPrediction?.riskLevel === 'high' || costPrediction?.riskLevel === 'critical') {
      parts.push(`Cost risk: ${costPrediction.riskLevel}.`);
    }

    return parts.join(' ');
  }

  private getDocumentationLinks(result: ExecutionDecisionResult): string[] {
    const links: string[] = [];

    links.push(`${this.documentationBaseUrl}/decisions/${result.decision}`);

    if (result.policyRulesTriggered.length > 0) {
      links.push(`${this.documentationBaseUrl}/policies/overview`);
    }

    if (result.costPrediction) {
      links.push(`${this.documentationBaseUrl}/cost-prediction`);
    }

    return links;
  }
}

// Export singleton
export const explainabilityLayer = new ExplainabilityLayer();
