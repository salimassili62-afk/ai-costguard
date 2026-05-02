/**
 * Logger.ts - Persistent Logging System
 * 
 * Stores all AI request data locally:
 * - timestamp
 * - request content (prompt)
 * - cost estimate
 * - risk score
 * - decision (ALLOW/BLOCK/WARN)
 * - model used
 * 
 * Storage: JSON file (simple, no external dependencies)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LogEntry {
  id: string;
  timestamp: number;
  date: string;
  prompt: string;
  model: string;
  estimatedCost: number;
  actualCost: number; // Always set: 0 for BLOCKED, real cost for ALLOWED
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  decision: 'ALLOW' | 'BLOCK' | 'WARN';
  category: string;
  reason: string;
  saved: number;
  wouldHaveLost: number;
  metadata?: {
    promptHash: string;
    duplicateCount: number;
    loopCount: number;
    tokens?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface LogQuery {
  startTime?: number;
  endTime?: number;
  decision?: 'ALLOW' | 'BLOCK' | 'WARN';
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  model?: string;
  limit?: number;
}

export interface LogStats {
  totalEntries: number;
  allowedCount: number;
  blockedCount: number;
  warnedCount: number;
  totalSaved: number;
  totalWouldHaveLost: number;
  averageRiskScore: number;
  entries: LogEntry[];
}

/**
 * Persistent Logger - Singleton
 * Stores logs in ~/.ai-execution-firewall/logs.json
 */
export class Logger {
  private static instance: Logger;
  private logDir: string;
  private logFile: string;
  private maxEntries: number = 10000;

  private constructor() {
    this.logDir = path.join(os.homedir(), '.ai-execution-firewall');
    this.logFile = path.join(this.logDir, 'logs.json');
    this.ensureDirectory();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Ensure log directory exists
   */
  private ensureDirectory(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Read all logs from file
   */
  private readLogs(): LogEntry[] {
    try {
      if (fs.existsSync(this.logFile)) {
        const data = fs.readFileSync(this.logFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('Error reading logs:', e);
    }
    return [];
  }

  /**
   * Write logs to file
   */
  private writeLogs(logs: LogEntry[]): void {
    try {
      this.ensureDirectory();
      fs.writeFileSync(this.logFile, JSON.stringify(logs, null, 2));
    } catch (e) {
      console.error('Error writing logs:', e);
    }
  }

  /**
   * Log a request
   * actualCost is always set: 0 for BLOCKED, real cost for ALLOWED
   */
  log(entry: Omit<LogEntry, 'id' | 'timestamp' | 'date'>): void {
    const now = Date.now();
    const fullEntry: LogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: now,
      date: new Date(now).toISOString(),
      // Ensure actualCost is always set
      actualCost: entry.actualCost ?? (entry.decision === 'BLOCK' ? 0 : entry.estimatedCost),
    };

    const logs = this.readLogs();
    logs.push(fullEntry);

    // Keep only last maxEntries to prevent file bloat
    if (logs.length > this.maxEntries) {
      logs.splice(0, logs.length - this.maxEntries);
    }

    this.writeLogs(logs);
  }

  /**
   * Query logs with filters
   */
  query(query: LogQuery = {}): LogEntry[] {
    let logs = this.readLogs();

    if (query.startTime !== undefined) {
      logs = logs.filter(l => l.timestamp >= query.startTime!);
    }

    if (query.endTime !== undefined) {
      logs = logs.filter(l => l.timestamp <= query.endTime!);
    }

    if (query.decision) {
      logs = logs.filter(l => l.decision === query.decision);
    }

    if (query.riskLevel) {
      logs = logs.filter(l => l.riskLevel === query.riskLevel);
    }

    if (query.model) {
      logs = logs.filter(l => l.model === query.model);
    }

    // Sort by timestamp descending (newest first)
    logs.sort((a, b) => b.timestamp - a.timestamp);

    if (query.limit) {
      logs = logs.slice(0, query.limit);
    }

    return logs;
  }

  /**
   * Get statistics for a time period
   */
  getStats(hours: number = 24): LogStats {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const logs = this.query({ startTime: cutoff });

    const allowedCount = logs.filter(l => l.decision === 'ALLOW').length;
    const blockedCount = logs.filter(l => l.decision === 'BLOCK').length;
    const warnedCount = logs.filter(l => l.decision === 'WARN').length;

    const totalSaved = logs.reduce((sum, l) => sum + l.saved, 0);
    const totalWouldHaveLost = logs.reduce((sum, l) => sum + l.wouldHaveLost, 0);

    const averageRiskScore = logs.length > 0
      ? logs.reduce((sum, l) => sum + l.riskScore, 0) / logs.length
      : 0;

    return {
      totalEntries: logs.length,
      allowedCount,
      blockedCount,
      warnedCount,
      totalSaved,
      totalWouldHaveLost,
      averageRiskScore: Math.round(averageRiskScore * 100) / 100,
      entries: logs.slice(0, 100), // Return last 100 for display
    };
  }

  /**
   * Get blocked requests
   */
  getBlocked(limit: number = 100): LogEntry[] {
    return this.query({ decision: 'BLOCK', limit });
  }

  /**
   * Get allowed requests
   */
  getAllowed(limit: number = 100): LogEntry[] {
    return this.query({ decision: 'ALLOW', limit });
  }

  /**
   * Get recent logs
   */
  getRecent(limit: number = 50): LogEntry[] {
    return this.query({ limit });
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.writeLogs([]);
  }

  /**
   * Export logs to file
   */
  exportLogs(filePath: string): boolean {
    try {
      const logs = this.readLogs();
      fs.writeFileSync(filePath, JSON.stringify(logs, null, 2));
      return true;
    } catch (e) {
      console.error('Error exporting logs:', e);
      return false;
    }
  }

  /**
   * Get log file path
   */
  getLogFilePath(): string {
    return this.logFile;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const logger = Logger.getInstance();
