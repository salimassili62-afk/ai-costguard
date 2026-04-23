import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface LogEntry {
  id?: number;
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  actualCost?: number;
  wasBlocked: boolean;
  wasteScore: number;
  reason?: string;
  promptHash: string;
}

export interface Stats {
  totalRequests: number;
  blockedRequests: number;
  totalCost: number;
  preventedCost: number;
  totalTokens: number;
}

export class Logger {
  private logFilePath: string;
  private logs: LogEntry[] = [];

  constructor(customLogPath?: string) {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.ai-waste-guard');
    
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    this.logFilePath = customLogPath || path.join(configDir, 'logs.json');
    this.loadLogs();
  }

  private loadLogs(): void {
    try {
      if (fs.existsSync(this.logFilePath)) {
        const data = fs.readFileSync(this.logFilePath, 'utf-8');
        this.logs = JSON.parse(data);
      }
    } catch (error) {
      this.logs = [];
    }
  }

  private saveLogs(): void {
    try {
      fs.writeFileSync(this.logFilePath, JSON.stringify(this.logs, null, 2));
    } catch (error) {
      console.error('Failed to save logs:', error);
    }
  }

  log(entry: LogEntry): void {
    entry.id = this.logs.length + 1;
    this.logs.push(entry);
    this.saveLogs();
  }

  getStats(hours: number = 24): Stats {
    const since = Date.now() - (hours * 60 * 60 * 1000);
    const recentLogs = this.logs.filter(log => log.timestamp > since);
    
    const totalRequests = recentLogs.length;
    const blockedRequests = recentLogs.filter(log => log.wasBlocked).length;
    const totalCost = recentLogs
      .filter(log => !log.wasBlocked && log.actualCost !== undefined)
      .reduce((sum, log) => sum + (log.actualCost || 0), 0);
    const preventedCost = recentLogs
      .filter(log => log.wasBlocked)
      .reduce((sum, log) => sum + log.estimatedCost, 0);
    const totalTokens = recentLogs.reduce(
      (sum, log) => sum + log.inputTokens + log.outputTokens,
      0
    );

    return {
      totalRequests,
      blockedRequests,
      totalCost,
      preventedCost,
      totalTokens,
    };
  }

  getRecentRequests(limit: number = 20): LogEntry[] {
    return this.logs.slice(-limit).reverse();
  }

  getBlockedRequests(limit: number = 20): LogEntry[] {
    return this.logs
      .filter(log => log.wasBlocked)
      .slice(-limit)
      .reverse();
  }

  clearOldLogs(days: number = 30): void {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    this.logs = this.logs.filter(log => log.timestamp > cutoff);
    this.saveLogs();
  }

  close(): void {
    this.saveLogs();
  }
}
