/**
 * AECL - ROI Telemetry System
 * 
 * Tracks measurable value:
 * - Estimated cost saved (blocked executions)
 * - Prevented execution value (what would have been spent)
 * - False positive tracking (blocked that shouldn't have been)
 * 
 * OUTPUT:
 * - Directly usable in billing dashboards
 * - CSV export for customer reporting
 * - 7-day ROI calculation
 * 
 * NO:
 * - Complex analytics
 * - ML predictions
 * - Attribution modeling
 */

export interface DecisionLog {
  timestamp: number;
  sessionId: string;
  requestId: string;
  decision: 'allow' | 'block';
  riskScore: number;
  estimatedCost: number;
  actualCost?: number;    // Filled after execution (if allowed)
  policyTriggered?: string;
  reason: string;
  latencyMs: number;
}

export interface ROIMetrics {
  totalDecisions: number;
  blockedCount: number;
  allowCount: number;
  estimatedSavings: number;      // Sum of blocked estimated costs
  actualSpend: number;           // Sum of actual costs (allowed)
  falsePositives: number;        // Blocked that user overrode
  falsePositiveCost: number;     // Cost of false positives
  netSavings: number;            // estimatedSavings - falsePositiveCost
  avgDecisionLatencyMs: number;
  p95DecisionLatencyMs: number;
}

export interface DailyReport {
  date: string;
  decisions: number;
  blocked: number;
  savings: number;
  spend: number;
  roi: number; // percentage
}

/**
 * ROI Telemetry
 * 
 * Simple, accurate tracking for customer billing.
 * Focus: Show measurable cost savings in first 7 days.
 */
export class ROITelemetry {
  private logs: DecisionLog[];
  private maxLogs: number;
  private falsePositiveLog: Set<string>; // requestIds marked as false positive

  constructor(maxLogs: number = 100000) {
    this.logs = [];
    this.maxLogs = maxLogs;
    this.falsePositiveLog = new Set();
  }

  /**
   * Log a decision
   */
  log(decision: DecisionLog): void {
    this.logs.push(decision);

    // Evict old logs if needed
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /**
   * Mark a blocked decision as false positive
   * (User overrode the block)
   */
  markFalsePositive(requestId: string, actualCost: number): void {
    this.falsePositiveLog.add(requestId);
    
    // Update the log entry
    const log = this.logs.find(l => l.requestId === requestId);
    if (log) {
      log.actualCost = actualCost;
    }
  }

  /**
   * Update actual cost for allowed execution
   */
  recordActualCost(requestId: string, actualCost: number): void {
    const log = this.logs.find(l => l.requestId === requestId);
    if (log) {
      log.actualCost = actualCost;
    }
  }

  /**
   * Get ROI metrics (all time)
   */
  getMetrics(): ROIMetrics {
    const total = this.logs.length;
    const blocked = this.logs.filter(l => l.decision === 'block');
    const allowed = this.logs.filter(l => l.decision === 'allow');

    const estimatedSavings = blocked.reduce((sum, l) => sum + l.estimatedCost, 0);
    const actualSpend = allowed
      .filter(l => l.actualCost !== undefined)
      .reduce((sum, l) => sum + (l.actualCost || 0), 0);

    const falsePositives = this.falsePositiveLog.size;
    const falsePositiveCost = blocked
      .filter(l => this.falsePositiveLog.has(l.requestId))
      .reduce((sum, l) => sum + l.estimatedCost, 0);

    const latencies = this.logs.map(l => l.latencyMs);
    const avgLatency = latencies.length > 0 
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
      : 0;
    const p95Latency = this.calculateP95(latencies);

    return {
      totalDecisions: total,
      blockedCount: blocked.length,
      allowCount: allowed.length,
      estimatedSavings,
      actualSpend,
      falsePositives,
      falsePositiveCost,
      netSavings: estimatedSavings - falsePositiveCost,
      avgDecisionLatencyMs: avgLatency,
      p95DecisionLatencyMs: p95Latency,
    };
  }

  /**
   * Get 7-day ROI report
   */
  get7DayReport(): { metrics: ROIMetrics; daily: DailyReport[] } {
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    
    const recentLogs = this.logs.filter(l => l.timestamp >= sevenDaysAgo);
    
    // Group by day
    const dailyMap = new Map<string, DecisionLog[]>();
    
    for (const log of recentLogs) {
      const date = new Date(log.timestamp).toISOString().split('T')[0];
      const existing = dailyMap.get(date) || [];
      existing.push(log);
      dailyMap.set(date, existing);
    }

    // Build daily reports
    const daily: DailyReport[] = [];
    for (const [date, logs] of dailyMap) {
      const blocked = logs.filter(l => l.decision === 'block');
      const allowed = logs.filter(l => l.decision === 'allow');
      
      const savings = blocked.reduce((sum, l) => sum + l.estimatedCost, 0);
      const spend = allowed
        .filter(l => l.actualCost !== undefined)
        .reduce((sum, l) => sum + (l.actualCost || 0), 0);

      daily.push({
        date,
        decisions: logs.length,
        blocked: blocked.length,
        savings,
        spend,
        roi: spend > 0 ? ((savings - spend) / spend) * 100 : 0,
      });
    }

    // Sort by date
    daily.sort((a, b) => a.date.localeCompare(b.date));

    // Calculate metrics for the period
    const totalBlocked = recentLogs.filter(l => l.decision === 'block');
    const totalAllowed = recentLogs.filter(l => l.decision === 'allow');
    
    const estimatedSavings = totalBlocked.reduce((sum, l) => sum + l.estimatedCost, 0);
    const actualSpend = totalAllowed
      .filter(l => l.actualCost !== undefined)
      .reduce((sum, l) => sum + (l.actualCost || 0), 0);

    const metrics: ROIMetrics = {
      totalDecisions: recentLogs.length,
      blockedCount: totalBlocked.length,
      allowCount: totalAllowed.length,
      estimatedSavings,
      actualSpend,
      falsePositives: this.falsePositiveLog.size,
      falsePositiveCost: totalBlocked
        .filter(l => this.falsePositiveLog.has(l.requestId))
        .reduce((sum, l) => sum + l.estimatedCost, 0),
      netSavings: estimatedSavings - (totalBlocked
        .filter(l => this.falsePositiveLog.has(l.requestId))
        .reduce((sum, l) => sum + l.estimatedCost, 0)),
      avgDecisionLatencyMs: recentLogs.length > 0
        ? recentLogs.reduce((sum, l) => sum + l.latencyMs, 0) / recentLogs.length
        : 0,
      p95DecisionLatencyMs: this.calculateP95(recentLogs.map(l => l.latencyMs)),
    };

    return { metrics, daily };
  }

  /**
   * Export to CSV for customer reporting
   */
  exportCSV(): string {
    const header = 'timestamp,sessionId,requestId,decision,riskScore,estimatedCost,actualCost,policyTriggered,latencyMs\n';
    
    const rows = this.logs.map(l => 
      `${new Date(l.timestamp).toISOString()},${l.sessionId},${l.requestId},${l.decision},${l.riskScore.toFixed(3)},${l.estimatedCost.toFixed(4)},${l.actualCost?.toFixed(4) || ''},${l.policyTriggered || ''},${l.latencyMs.toFixed(2)}`
    ).join('\n');

    return header + rows;
  }

  /**
   * Calculate simple 7-day ROI percentage
   */
  calculateROI(): number {
    const { metrics } = this.get7DayReport();
    
    if (metrics.actualSpend === 0) {
      return metrics.estimatedSavings > 0 ? 100 : 0;
    }

    return ((metrics.estimatedSavings - metrics.actualSpend) / metrics.actualSpend) * 100;
  }

  /**
   * Get summary for dashboard
   */
  getDashboardSummary(): {
    decisionsToday: number;
    savingsToday: number;
    totalSavings: number;
    roi7Day: number;
  } {
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = this.logs.filter(l => 
      new Date(l.timestamp).toISOString().startsWith(today)
    );

    const savingsToday = todayLogs
      .filter(l => l.decision === 'block')
      .reduce((sum, l) => sum + l.estimatedCost, 0);

    const allMetrics = this.getMetrics();

    return {
      decisionsToday: todayLogs.length,
      savingsToday,
      totalSavings: allMetrics.netSavings,
      roi7Day: this.calculateROI(),
    };
  }

  private calculateP95(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  }

  /**
   * Reset (for testing)
   */
  reset(): void {
    this.logs = [];
    this.falsePositiveLog.clear();
  }
}

export const roiTelemetry = new ROITelemetry();
