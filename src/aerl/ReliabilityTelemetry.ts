/**
 * AERL - ROI + Reliability Telemetry
 * 
 * Measures measurable outcomes for enterprise adoption:
 * - Estimated cost saved
 * - Failures prevented
 * - Reliability improvement score
 * - Execution success probability delta
 * 
 * OUTPUT:
 * - Dashboard-ready metrics
 * - CSV export for billing
 * - 7-day reliability report
 * - Per-workflow success tracking
 */

export interface DecisionTelemetry {
  timestamp: number;
  sessionId: string;
  workflowId: string;
  requestId: string;
  decision: 'allow' | 'block' | 'modify';
  riskScore: number;
  reliabilityScore: number;
  estimatedCost: number;
  actualCost?: number;
  predictedFailure?: boolean;
  actualFailure?: boolean;
  actionTaken?: string;
  success?: boolean;
  latencyMs: number;
}

export interface ReliabilityMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  blockedExecutions: number;
  modifiedExecutions: number;
  
  // Cost metrics
  estimatedCostSaved: number;
  actualSpend: number;
  netSavings: number;
  
  // Reliability metrics
  failuresPrevented: number;
  falsePositives: number;      // Blocked but would have succeeded
  predictionAccuracy: number;  // % of correct predictions
  reliabilityImprovement: number; // % improvement over baseline
  
  // Latency metrics
  avgDecisionLatencyMs: number;
  p95DecisionLatencyMs: number;
}

export interface WorkflowReport {
  workflowId: string;
  totalExecutions: number;
  successRate: number;
  avgCost: number;
  avgDurationMs: number;
  reliabilityScore: number;
  improvementOverTime: number[]; // Reliability trend
}

export class ReliabilityTelemetry {
  private telemetry: DecisionTelemetry[];
  private maxEntries: number;
  private falsePositiveLog: Set<string>; // requestIds

  constructor(maxEntries: number = 100000) {
    this.telemetry = [];
    this.maxEntries = maxEntries;
    this.falsePositiveLog = new Set();
  }

  /**
   * Log a decision
   */
  log(entry: DecisionTelemetry): void {
    this.telemetry.push(entry);

    if (this.telemetry.length > this.maxEntries) {
      this.telemetry.shift();
    }
  }

  /**
   * Mark a blocked decision as false positive
   * (Would have succeeded if allowed)
   */
  markFalsePositive(requestId: string, actualCost: number): void {
    this.falsePositiveLog.add(requestId);

    const entry = this.telemetry.find(t => t.requestId === requestId);
    if (entry) {
      entry.actualCost = actualCost;
      entry.success = true; // Would have succeeded
    }
  }

  /**
   * Record actual execution result
   */
  recordResult(requestId: string, actualCost: number, success: boolean): void {
    const entry = this.telemetry.find(t => t.requestId === requestId);
    if (entry) {
      entry.actualCost = actualCost;
      entry.success = success;
      entry.actualFailure = !success;
    }
  }

  /**
   * Get overall reliability metrics
   */
  getMetrics(): ReliabilityMetrics {
    const total = this.telemetry.length;
    const allowed = this.telemetry.filter(t => t.decision === 'allow');
    const blocked = this.telemetry.filter(t => t.decision === 'block');
    const modified = this.telemetry.filter(t => t.decision === 'modify');
    const succeeded = this.telemetry.filter(t => t.success === true);
    const failed = this.telemetry.filter(t => t.success === false);

    // Cost calculations
    const estimatedSaved = blocked.reduce((sum, t) => sum + t.estimatedCost, 0);
    const actualSpend = allowed
      .filter(t => t.actualCost !== undefined)
      .reduce((sum, t) => sum + (t.actualCost || 0), 0);

    // False positives = blocked but would have succeeded
    const falsePositives = blocked.filter(t => 
      this.falsePositiveLog.has(t.requestId)
    ).length;

    // Prediction accuracy
    const predictions = this.telemetry.filter(t => t.predictedFailure !== undefined);
    const correctPredictions = predictions.filter(t => 
      t.predictedFailure === t.actualFailure
    ).length;
    const predictionAccuracy = predictions.length > 0
      ? correctPredictions / predictions.length
      : 0;

    // Reliability improvement
    const baselineSuccessRate = 0.7; // Assume 70% without AERL
    const actualSuccessRate = total > 0 ? succeeded.length / total : 0;
    const improvement = actualSuccessRate - baselineSuccessRate;

    // Latency
    const latencies = this.telemetry.map(t => t.latencyMs);
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;
    const p95Latency = this.calculateP95(latencies);

    return {
      totalExecutions: total,
      successfulExecutions: succeeded.length,
      failedExecutions: failed.length,
      blockedExecutions: blocked.length,
      modifiedExecutions: modified.length,
      estimatedCostSaved: estimatedSaved,
      actualSpend,
      netSavings: estimatedSaved - actualSpend,
      failuresPrevented: blocked.filter(t => 
        t.predictedFailure && !this.falsePositiveLog.has(t.requestId)
      ).length,
      falsePositives,
      predictionAccuracy,
      reliabilityImprovement: improvement,
      avgDecisionLatencyMs: avgLatency,
      p95DecisionLatencyMs: p95Latency,
    };
  }

  /**
   * Get 7-day reliability report
   */
  get7DayReport(): {
    metrics: ReliabilityMetrics;
    daily: Array<{
      date: string;
      executions: number;
      successRate: number;
      costSaved: number;
      reliabilityScore: number;
    }>;
  } {
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const recent = this.telemetry.filter(t => t.timestamp >= sevenDaysAgo);

    // Group by day
    const dailyMap = new Map<string, DecisionTelemetry[]>();
    for (const entry of recent) {
      const date = new Date(entry.timestamp).toISOString().split('T')[0];
      const existing = dailyMap.get(date) || [];
      existing.push(entry);
      dailyMap.set(date, existing);
    }

    // Build daily reports
    const daily = [];
    for (const [date, entries] of dailyMap) {
      const succeeded = entries.filter(e => e.success).length;
      const saved = entries
        .filter(e => e.decision === 'block')
        .reduce((sum, e) => sum + e.estimatedCost, 0);
      
      daily.push({
        date,
        executions: entries.length,
        successRate: entries.length > 0 ? succeeded / entries.length : 0,
        costSaved: saved,
        reliabilityScore: entries.length > 0
          ? entries.reduce((sum, e) => sum + e.reliabilityScore, 0) / entries.length
          : 0,
      });
    }

    daily.sort((a, b) => a.date.localeCompare(b.date));

    // Calculate metrics for the period
    const total = recent.length;
    const succeeded = recent.filter(t => t.success).length;
    const blocked = recent.filter(t => t.decision === 'block');
    const estimatedSaved = blocked.reduce((sum, t) => sum + t.estimatedCost, 0);
    const actualSpend = recent
      .filter(t => t.decision === 'allow' && t.actualCost !== undefined)
      .reduce((sum, t) => sum + (t.actualCost || 0), 0);

    const metrics: ReliabilityMetrics = {
      totalExecutions: total,
      successfulExecutions: succeeded,
      failedExecutions: recent.filter(t => t.success === false).length,
      blockedExecutions: blocked.length,
      modifiedExecutions: recent.filter(t => t.decision === 'modify').length,
      estimatedCostSaved: estimatedSaved,
      actualSpend,
      netSavings: estimatedSaved - actualSpend,
      failuresPrevented: blocked.filter(t => 
        t.predictedFailure && !this.falsePositiveLog.has(t.requestId)
      ).length,
      falsePositives: blocked.filter(t => 
        this.falsePositiveLog.has(t.requestId)
      ).length,
      predictionAccuracy: 0, // Would need full tracking
      reliabilityImprovement: 0,
      avgDecisionLatencyMs: recent.length > 0
        ? recent.reduce((sum, t) => sum + t.latencyMs, 0) / recent.length
        : 0,
      p95DecisionLatencyMs: this.calculateP95(recent.map(t => t.latencyMs)),
    };

    return { metrics, daily };
  }

  /**
   * Get per-workflow report
   */
  getWorkflowReport(workflowId: string): WorkflowReport | undefined {
    const entries = this.telemetry.filter(t => t.workflowId === workflowId);
    if (entries.length === 0) return undefined;

    const total = entries.length;
    const succeeded = entries.filter(t => t.success).length;
    const costs = entries
      .filter(t => t.actualCost !== undefined)
      .map(t => t.actualCost || 0);
    
    // Calculate trend (reliability by day)
    const dailyMap = new Map<string, number[]>();
    for (const entry of entries) {
      const date = new Date(entry.timestamp).toISOString().split('T')[0];
      const existing = dailyMap.get(date) || [];
      existing.push(entry.reliabilityScore);
      dailyMap.set(date, existing);
    }

    const trend = Array.from(dailyMap.values())
      .map(scores => scores.reduce((a, b) => a + b, 0) / scores.length);

    return {
      workflowId,
      totalExecutions: total,
      successRate: succeeded / total,
      avgCost: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
      avgDurationMs: 0, // Would need duration tracking
      reliabilityScore: entries.reduce((sum, t) => sum + t.reliabilityScore, 0) / total,
      improvementOverTime: trend,
    };
  }

  /**
   * Export CSV for billing dashboards
   */
  exportCSV(): string {
    const header = 'timestamp,sessionId,workflowId,requestId,decision,riskScore,reliabilityScore,estimatedCost,actualCost,predictedFailure,actualFailure,success,latencyMs\n';
    
    const rows = this.telemetry.map(t => 
      `${new Date(t.timestamp).toISOString()},${t.sessionId},${t.workflowId},${t.requestId},${t.decision},${t.riskScore.toFixed(3)},${t.reliabilityScore.toFixed(3)},${t.estimatedCost.toFixed(4)},${t.actualCost?.toFixed(4) || ''},${t.predictedFailure || ''},${t.actualFailure || ''},${t.success ?? ''},${t.latencyMs.toFixed(2)}`
    ).join('\n');

    return header + rows;
  }

  /**
   * Get dashboard summary
   */
  getDashboardSummary(): {
    executionsToday: number;
    successRateToday: number;
    costSavedToday: number;
    totalCostSaved: number;
    reliability7Day: number;
    predictionAccuracy: number;
  } {
    const today = new Date().toISOString().split('T')[0];
    const todayEntries = this.telemetry.filter(t => 
      new Date(t.timestamp).toISOString().startsWith(today)
    );

    const succeeded = todayEntries.filter(t => t.success).length;
    const saved = todayEntries
      .filter(t => t.decision === 'block')
      .reduce((sum, t) => sum + t.estimatedCost, 0);

    const allMetrics = this.getMetrics();
    const report7Day = this.get7DayReport();

    return {
      executionsToday: todayEntries.length,
      successRateToday: todayEntries.length > 0 ? succeeded / todayEntries.length : 0,
      costSavedToday: saved,
      totalCostSaved: allMetrics.netSavings,
      reliability7Day: report7Day.daily.length > 0
        ? report7Day.daily.reduce((sum, d) => sum + d.reliabilityScore, 0) / report7Day.daily.length
        : 0,
      predictionAccuracy: allMetrics.predictionAccuracy,
    };
  }

  private calculateP95(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  }

  /**
   * Reset
   */
  reset(): void {
    this.telemetry = [];
    this.falsePositiveLog.clear();
  }
}

export const reliabilityTelemetry = new ReliabilityTelemetry();
