import { TelemetryStore } from './telemetry';
import { UsageSnapshot } from './usageMeter';

export interface DashboardMetrics {
  apiKey: string;
  totalSavedUsd: number;
  estimatedSpendUsd: number;
  roiRatio: number;
  blockedVsAllowedRatio: number;
}

export class BillingMetrics {
  compute(
    apiKey: string,
    telemetry: TelemetryStore,
    usage: UsageSnapshot,
    monthlyProductCostUsd = 99
  ): DashboardMetrics {
    const summary = telemetry.getSummary();
    const totalSavedUsd = summary.costSavedEstimateUsd;
    const estimatedSpendUsd = usage.monthlyCostUsd;
    const roiRatio = monthlyProductCostUsd === 0 ? 0 : totalSavedUsd / monthlyProductCostUsd;

    return {
      apiKey,
      totalSavedUsd: Number(totalSavedUsd.toFixed(6)),
      estimatedSpendUsd: Number(estimatedSpendUsd.toFixed(6)),
      roiRatio: Number(roiRatio.toFixed(4)),
      blockedVsAllowedRatio: Number(summary.blockedVsAllowedRatio.toFixed(4)),
    };
  }

  exportDashboardJson(metrics: DashboardMetrics): string {
    return JSON.stringify(metrics, null, 2);
  }
}
