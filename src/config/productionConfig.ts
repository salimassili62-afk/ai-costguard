import { UserConfig } from './userConfig';

export interface ProductionConfigOverrides extends Partial<UserConfig> {}

/**
 * One-step production bootstrap with safe, ROI-focused defaults.
 */
export function productionConfig(overrides: ProductionConfigOverrides = {}): UserConfig {
  return {
    trustMode: 'block',
    maxCostPerRequest: 0.75,
    dangerThreshold: 50,
    allowOverride: false,
    proxyPort: 3000,
    logRetentionDays: 30,
    apiKey: process.env.AIFW_API_KEY,
    rateLimitPerMinute: 120,
    dailyBudget: 100,
    ...overrides,
  };
}
