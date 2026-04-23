import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface UserConfig {
  blockMode: boolean;
  maxCostPerRequest: number;
  wasteThreshold: number;
  allowOverride: boolean;
  proxyPort: number;
  logRetentionDays: number;
}

const DEFAULT_CONFIG: UserConfig = {
  blockMode: true,
  maxCostPerRequest: 1.0,
  wasteThreshold: 50,
  allowOverride: true,
  proxyPort: 3000,
  logRetentionDays: 30,
};

export class ConfigManager {
  private configPath: string;
  private config: UserConfig;

  constructor(customConfigPath?: string) {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.ai-waste-guard');
    
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

  get blockMode(): boolean {
    return this.config.blockMode;
  }

  get maxCostPerRequest(): number {
    return this.config.maxCostPerRequest;
  }

  get wasteThreshold(): number {
    return this.config.wasteThreshold;
  }

  get allowOverride(): boolean {
    return this.config.allowOverride;
  }

  get proxyPort(): number {
    return this.config.proxyPort;
  }
}
