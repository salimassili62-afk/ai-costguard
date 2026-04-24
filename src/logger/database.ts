import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface LogEntry {
  id?: number;
  traceId: string;
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  wasBlocked: boolean;
  dangerScore: number;
  reason?: string;
  promptHash: string;
  decisionTrace?: {
    category: string;
    severity: string;
    action: string;
    killSwitchTriggered: boolean;
  };
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
  private logDir: string;

  constructor(customLogPath?: string) {
    const homeDir = os.homedir();
    this.logDir = path.join(homeDir, '.ai-execution-firewall');
    
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.logFilePath = customLogPath || path.join(this.logDir, 'logs.jsonl');
  }

  log(entry: LogEntry): void {
    entry.id = Date.now();
    if (!entry.traceId) {
      entry.traceId = this.generateTraceId();
    }
    const logLine = JSON.stringify(entry) + '\n';
    
    try {
      fs.appendFileSync(this.logFilePath, logLine, 'utf-8');
    } catch (error) {
      console.error('Failed to append log:', error);
    }
  }

  private generateTraceId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  }

  getStats(hours: number = 24): Stats {
    const since = Date.now() - (hours * 60 * 60 * 1000);
    const recentLogs = this.loadLogs().filter(log => log.timestamp > since);
    
    const totalRequests = recentLogs.length;
    const blockedRequests = recentLogs.filter(log => log.wasBlocked).length;
    const totalCost = recentLogs
      .filter(log => !log.wasBlocked)
      .reduce((sum, log) => sum + log.estimatedCost, 0);
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
    const logs = this.loadLogs();
    return logs.slice(-limit).reverse();
  }

  getBlockedRequests(limit: number = 20): LogEntry[] {
    const logs = this.loadLogs();
    return logs
      .filter(log => log.wasBlocked)
      .slice(-limit)
      .reverse();
  }

  private loadLogs(): LogEntry[] {
    try {
      if (!fs.existsSync(this.logFilePath)) {
        return [];
      }
      
      const data = fs.readFileSync(this.logFilePath, 'utf-8');
      const lines = data.trim().split('\n');
      
      return lines
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      console.error('Failed to load logs:', error);
      return [];
    }
  }

  clearOldLogs(days: number = 30): void {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const logs = this.loadLogs().filter(log => log.timestamp > cutoff);
    
    try {
      fs.writeFileSync(this.logFilePath, logs.map(log => JSON.stringify(log)).join('\n') + '\n', 'utf-8');
    } catch (error) {
      console.error('Failed to clear old logs:', error);
    }
  }

  close(): void {
    // No-op: logs are appended incrementally, no need to flush
  }
}
