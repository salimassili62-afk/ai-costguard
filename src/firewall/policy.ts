import { GuardPolicy } from './types';

export const DEFAULT_POLICY: GuardPolicy = {
  maxCostUsd: 0.15,
  throttleCostUsd: 0.06,
  loopWindowMs: 30_000,
  loopThreshold: 3,
  requestsPerMinute: 60,
  strict: false,
};

export function createPolicy(overrides: Partial<GuardPolicy> = {}): GuardPolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}
