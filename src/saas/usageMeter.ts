export interface UsageRecord {
  apiKey: string;
  at: number;
  estimatedCostUsd: number;
}

export interface UsageLimitConfig {
  dailyRequestLimit: number;
  monthlyRequestLimit: number;
  dailyCostLimitUsd: number;
  monthlyCostLimitUsd: number;
}

export interface UsageSnapshot {
  apiKey: string;
  dailyRequests: number;
  monthlyRequests: number;
  dailyCostUsd: number;
  monthlyCostUsd: number;
  exceedsDailyLimit: boolean;
  exceedsMonthlyLimit: boolean;
}

const DEFAULT_LIMITS: UsageLimitConfig = {
  dailyRequestLimit: 10_000,
  monthlyRequestLimit: 250_000,
  dailyCostLimitUsd: 100,
  monthlyCostLimitUsd: 2_000,
};

export class UsageMeter {
  private records = new Map<string, UsageRecord[]>();
  private readonly limits: UsageLimitConfig;

  constructor(limits: Partial<UsageLimitConfig> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  track(apiKey: string, estimatedCostUsd: number, at = Date.now()): UsageSnapshot {
    const list = this.records.get(apiKey) ?? [];
    list.push({ apiKey, at, estimatedCostUsd });
    this.records.set(apiKey, list);
    return this.getSnapshot(apiKey, at);
  }

  getSnapshot(apiKey: string, now = Date.now()): UsageSnapshot {
    const list = this.records.get(apiKey) ?? [];
    const dayAgo = now - 86_400_000;
    const monthAgo = now - 30 * 86_400_000;
    const day = list.filter(r => r.at >= dayAgo);
    const month = list.filter(r => r.at >= monthAgo);
    const dailyCost = day.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
    const monthlyCost = month.reduce((sum, item) => sum + item.estimatedCostUsd, 0);

    return {
      apiKey,
      dailyRequests: day.length,
      monthlyRequests: month.length,
      dailyCostUsd: Number(dailyCost.toFixed(6)),
      monthlyCostUsd: Number(monthlyCost.toFixed(6)),
      exceedsDailyLimit: day.length > this.limits.dailyRequestLimit || dailyCost > this.limits.dailyCostLimitUsd,
      exceedsMonthlyLimit:
        month.length > this.limits.monthlyRequestLimit || monthlyCost > this.limits.monthlyCostLimitUsd,
    };
  }
}
