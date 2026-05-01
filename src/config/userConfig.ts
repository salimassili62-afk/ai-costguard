import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export type TrustMode = 'monitor' | 'warn' | 'block';
export type PromptStorageMode = 'hash' | 'redacted' | 'plaintext';
export type StorageAdapterType = 'memory' | 'jsonl' | 'sqlite' | 'postgres';
export type AlertChannelType = 'webhook' | 'slack' | 'pagerduty';

export interface MetadataScope {
  orgId?: string;
  teamId?: string;
  appId?: string;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  workflowId?: string;
  apiKeyId?: string;
  model?: string;
}

export interface BudgetConfig {
  perRequestUsd: number;
  dailyUsd: number;
  monthlyUsd: number;
  workflowUsd?: number;
  tokensPerRequest?: number;
}

export interface ScopedPolicyConfig {
  id: string;
  description?: string;
  scope: MetadataScope;
  trustMode?: TrustMode;
  budgets?: Partial<BudgetConfig>;
}

export interface PrivacyConfig {
  promptStorage: PromptStorageMode;
  redactPatterns: string[];
  retentionDays: number;
  encryptionKeyEnv?: string;
}

export interface StorageConfig {
  adapter: StorageAdapterType;
  path?: string;
  connectionString?: string;
}

export interface ThresholdConfig {
  killSwitchScore: number;
  loopCount: number;
  loopWindowMs: number;
  duplicateWindowMs: number;
  costSpikeUsd: number;
  contextRatio: number;
  fuzzySimilarity: number;
}

export interface AlertChannelConfig {
  type: AlertChannelType;
  url: string;
  minRiskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  enabled?: boolean;
}

export interface AlertsConfig {
  enabled: boolean;
  channels: AlertChannelConfig[];
}

export interface PricingConfigOverrides {
  registryVersion: string;
  customModels: Record<
    string,
    {
      provider: string;
      inputPer1K: number;
      outputPer1K: number;
      cachedInputPer1K?: number;
      reasoningOutputPer1K?: number;
      aliases?: string[];
    }
  >;
}

export interface MetadataConfig {
  required: Array<keyof MetadataScope>;
  passthroughHeaders: string[];
}

export interface UserConfig {
  trustMode: TrustMode;
  maxCostPerRequest: number;
  dangerThreshold: number;
  allowOverride: boolean;
  proxyPort: number;
  logRetentionDays: number;
  apiKey?: string;
  rateLimitPerMinute: number;
  dailyBudget: number; // Daily spending limit for budget protection
  privacy: PrivacyConfig;
  storage: StorageConfig;
  budgets: BudgetConfig;
  thresholds: ThresholdConfig;
  policies: ScopedPolicyConfig[];
  alerts: AlertsConfig;
  pricing: PricingConfigOverrides;
  metadata: MetadataConfig;
}

const DEFAULT_CONFIG: UserConfig = {
  trustMode: 'block', // STRICT DEFAULT: block mode for production safety
  maxCostPerRequest: 1.0,
  dangerThreshold: 50,
  allowOverride: false, // STRICT DEFAULT: cannot override without config file
  proxyPort: 3000,
  logRetentionDays: 30,
  apiKey: undefined,
  rateLimitPerMinute: 60,
  dailyBudget: 50.0, // $50/day default budget protection
  privacy: {
    promptStorage: 'hash',
    redactPatterns: [
      '(sk-[A-Za-z0-9_-]{20,})',
      '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})',
      '((?:\\d[ -]*?){13,19})',
    ],
    retentionDays: 30,
  },
  storage: {
    adapter: 'jsonl',
  },
  budgets: {
    perRequestUsd: 1.0,
    dailyUsd: 50.0,
    monthlyUsd: 1000.0,
  },
  thresholds: {
    killSwitchScore: 90,
    loopCount: 3,
    loopWindowMs: 30000,
    duplicateWindowMs: 3600000,
    costSpikeUsd: 0.05,
    contextRatio: 5,
    fuzzySimilarity: 0.7,
  },
  policies: [],
  alerts: {
    enabled: false,
    channels: [],
  },
  pricing: {
    registryVersion: '2026-04-30',
    customModels: {},
  },
  metadata: {
    required: [],
    passthroughHeaders: ['x-request-id', 'x-tenant-id', 'x-user-id', 'x-session-id', 'x-agent-id', 'x-workflow-id'],
  },
};

export class ConfigManager {
  private configPath: string;
  private config: UserConfig;

  constructor(customConfigPath?: string) {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.aifw');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const projectConfigPath = path.join(process.cwd(), 'aifw.config.json');
    this.configPath =
      customConfigPath || (fs.existsSync(projectConfigPath) ? projectConfigPath : path.join(configDir, 'config.json'));
    this.config = this.loadConfig();
  }

  private loadConfig(): UserConfig {
    if (!fs.existsSync(this.configPath)) {
      this.saveConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }

    try {
      const data = fs.readFileSync(this.configPath, 'utf-8');
      const loaded = JSON.parse(data);
      return this.normalizeConfig(loaded);
    } catch (error) {
      console.warn('Failed to load config, using defaults');
      return { ...DEFAULT_CONFIG };
    }
  }

  private saveConfig(config: UserConfig): void {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  private normalizeConfig(loaded: Partial<UserConfig> & Record<string, any>): UserConfig {
    const legacyTrustMode = loaded.trustMode || loaded.mode;
    const legacyDailyBudget = loaded.dailyBudget ?? loaded.budgets?.dailyUsd;
    const legacyMaxCost = loaded.maxCostPerRequest ?? loaded.budgets?.perRequestUsd;
    const legacyDangerThreshold = loaded.dangerThreshold ?? loaded.riskThreshold;

    const merged: UserConfig = {
      ...DEFAULT_CONFIG,
      ...loaded,
      trustMode: legacyTrustMode || DEFAULT_CONFIG.trustMode,
      maxCostPerRequest: legacyMaxCost ?? DEFAULT_CONFIG.maxCostPerRequest,
      dangerThreshold: legacyDangerThreshold ?? DEFAULT_CONFIG.dangerThreshold,
      dailyBudget: legacyDailyBudget ?? DEFAULT_CONFIG.dailyBudget,
      privacy: { ...DEFAULT_CONFIG.privacy, ...(loaded.privacy || {}) },
      storage: { ...DEFAULT_CONFIG.storage, ...(loaded.storage || {}) },
      budgets: {
        ...DEFAULT_CONFIG.budgets,
        ...(loaded.budgets || {}),
        perRequestUsd: legacyMaxCost ?? loaded.budgets?.perRequestUsd ?? DEFAULT_CONFIG.budgets.perRequestUsd,
        dailyUsd: legacyDailyBudget ?? loaded.budgets?.dailyUsd ?? DEFAULT_CONFIG.budgets.dailyUsd,
      },
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...(loaded.thresholds || {}) },
      policies: loaded.policies || DEFAULT_CONFIG.policies,
      alerts: {
        ...DEFAULT_CONFIG.alerts,
        ...(loaded.alerts || {}),
        channels: loaded.alerts?.channels || DEFAULT_CONFIG.alerts.channels,
      },
      pricing: {
        ...DEFAULT_CONFIG.pricing,
        ...(loaded.pricing || {}),
        customModels: {
          ...DEFAULT_CONFIG.pricing.customModels,
          ...(loaded.pricing?.customModels || {}),
        },
      },
      metadata: {
        ...DEFAULT_CONFIG.metadata,
        ...(loaded.metadata || {}),
        required: loaded.metadata?.required || DEFAULT_CONFIG.metadata.required,
        passthroughHeaders: loaded.metadata?.passthroughHeaders || DEFAULT_CONFIG.metadata.passthroughHeaders,
      },
    };

    return merged;
  }

  getConfig(): UserConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<UserConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig(this.config);
  }

  resetConfig(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.saveConfig(this.config);
  }

  get trustMode(): TrustMode {
    return this.config.trustMode;
  }

  get maxCostPerRequest(): number {
    return this.config.maxCostPerRequest;
  }

  get dangerThreshold(): number {
    return this.config.dangerThreshold;
  }

  get allowOverride(): boolean {
    return this.config.allowOverride;
  }

  get proxyPort(): number {
    return this.config.proxyPort;
  }

  get dailyBudget(): number {
    return this.config.budgets.dailyUsd ?? this.config.dailyBudget;
  }

  get apiKey(): string | undefined {
    return this.config.apiKey;
  }

  get rateLimitPerMinute(): number {
    return this.config.rateLimitPerMinute;
  }

  get privacy(): PrivacyConfig {
    return { ...this.config.privacy };
  }

  get storage(): StorageConfig {
    return { ...this.config.storage };
  }

  get budgets(): BudgetConfig {
    return { ...this.config.budgets };
  }

  get thresholds(): ThresholdConfig {
    return { ...this.config.thresholds };
  }

  get policies(): ScopedPolicyConfig[] {
    return [...this.config.policies];
  }

  get alerts(): AlertsConfig {
    return {
      ...this.config.alerts,
      channels: [...this.config.alerts.channels],
    };
  }
}
