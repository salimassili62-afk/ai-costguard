import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export type TrustMode = 'monitor' | 'warn' | 'block';

export interface UserConfig {
  trustMode: TrustMode;
  maxCostPerRequest: number;
  dangerThreshold: number;
  allowOverride: boolean;
  proxyPort: number;
  logRetentionDays: number;
  apiKey?: string;
  rateLimitPerMinute: number;
}

const DEFAULT_CONFIG: UserConfig = {
  trustMode: 'warn',
  maxCostPerRequest: 1.0,
  dangerThreshold: 50,
  allowOverride: true,
  proxyPort: 3000,
  logRetentionDays: 30,
  apiKey: undefined,
  rateLimitPerMinute: 60,
};

export class ConfigManager {
  private configPath: string;
  private config: UserConfig;

  constructor(customConfigPath?: string) {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.ai-execution-firewall');
    
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    this.configPath = customConfigPath || path.join(configDir, 'config.json');
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
      return { ...DEFAULT_CONFIG, ...loaded };
    } catch (error) {
      console.warn('Failed to load config, using defaults');
      return { ...DEFAULT_CONFIG };
    }
  }

  private saveConfig(config: UserConfig): void {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
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

  get apiKey(): string | undefined {
    return this.config.apiKey;
  }

  get rateLimitPerMinute(): number {
    return this.config.rateLimitPerMinute;
  }
}
