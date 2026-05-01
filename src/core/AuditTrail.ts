/**
 * AuditTrail.ts - Complete Audit Trail System
 *
 * Stores ALL blocked and allowed requests
 * Supports CLI queries: aifw blocked, aifw logs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AuditEntry {
  id: string;
  timestamp: number;
  date: string;
  type: 'blocked' | 'allowed' | 'warned';
  prompt: string;
  model: string;
  estimatedCost: number;
  actualCost?: number;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  decision: 'ALLOW' | 'BLOCK' | 'WARN';
  category: string;
  reason: string;
  saved: number;
  wouldHaveLost: number;
  metadata: {
    promptHash: string;
    duplicateCount: number;
    loopCount: number;
    source?: string; // 'cli', 'middleware', 'sdk', 'proxy'
  };
}

export interface AuditQuery {
  type?: 'blocked' | 'allowed' | 'warned';
  startTime?: number;
  endTime?: number;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category?: string;
  limit?: number;
  source?: string;
}

export interface AuditStats {
  totalBlocked: number;
  totalAllowed: number;
  totalWarned: number;
  totalSaved: number;
  totalWouldHaveLost: number;
  byCategory: Record<string, number>;
  byRiskLevel: Record<string, number>;
  recentBlocked: AuditEntry[];
  recentAllowed: AuditEntry[];
}

/**
 * AuditTrail - Complete record of all AI request decisions
 */
export class AuditTrail {
  private static instance: AuditTrail;
  private auditDir: string;
  private blockedFile: string;
  private allowedFile: string;
  private warnedFile: string;
  private maxEntriesPerFile: number = 5000;

  private constructor() {
    this.auditDir = path.join(os.homedir(), '.ai-execution-firewall', 'audit');
    this.blockedFile = path.join(this.auditDir, 'blocked.json');
    this.allowedFile = path.join(this.auditDir, 'allowed.json');
    this.warnedFile = path.join(this.auditDir, 'warned.json');
    this.ensureDirectory();
  }

  static getInstance(): AuditTrail {
    if (!AuditTrail.instance) {
      AuditTrail.instance = new AuditTrail();
    }
    return AuditTrail.instance;
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.auditDir)) {
      fs.mkdirSync(this.auditDir, { recursive: true });
    }
  }

  private readFile(filePath: string): AuditEntry[] {
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error(`Error reading ${filePath}:`, e);
    }
    return [];
  }

  private writeFile(filePath: string, entries: AuditEntry[]): void {
    try {
      this.ensureDirectory();
      fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
    } catch (e) {
      console.error(`Error writing ${filePath}:`, e);
    }
  }

  /**
   * Record an audit entry
   */
  record(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'date'>): void {
    const now = Date.now();
    const fullEntry: AuditEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: now,
      date: new Date(now).toISOString(),
    };

    // Determine which file to write to
    let filePath: string;
    switch (entry.type) {
      case 'blocked':
        filePath = this.blockedFile;
        break;
      case 'allowed':
        filePath = this.allowedFile;
        break;
      case 'warned':
        filePath = this.warnedFile;
        break;
      default:
        filePath = this.allowedFile;
    }

    const entries = this.readFile(filePath);
    entries.push(fullEntry);

    // Keep only last maxEntries
    if (entries.length > this.maxEntriesPerFile) {
      entries.splice(0, entries.length - this.maxEntriesPerFile);
    }

    this.writeFile(filePath, entries);
  }

  /**
   * Query audit trail with filters
   */
  query(query: AuditQuery = {}): AuditEntry[] {
    let allEntries: AuditEntry[] = [];

    // Read appropriate files
    if (!query.type || query.type === 'blocked') {
      allEntries = allEntries.concat(this.readFile(this.blockedFile));
    }
    if (!query.type || query.type === 'allowed') {
      allEntries = allEntries.concat(this.readFile(this.allowedFile));
    }
    if (!query.type || query.type === 'warned') {
      allEntries = allEntries.concat(this.readFile(this.warnedFile));
    }

    // Apply filters
    if (query.startTime !== undefined) {
      allEntries = allEntries.filter((e) => e.timestamp >= query.startTime!);
    }

    if (query.endTime !== undefined) {
      allEntries = allEntries.filter((e) => e.timestamp <= query.endTime!);
    }

    if (query.riskLevel) {
      allEntries = allEntries.filter((e) => e.riskLevel === query.riskLevel);
    }

    if (query.category) {
      allEntries = allEntries.filter((e) => e.category === query.category);
    }

    if (query.source) {
      allEntries = allEntries.filter((e) => e.metadata?.source === query.source);
    }

    // Sort by timestamp descending
    allEntries.sort((a, b) => b.timestamp - a.timestamp);

    if (query.limit) {
      allEntries = allEntries.slice(0, query.limit);
    }

    return allEntries;
  }

  /**
   * Get blocked requests (for CLI: aifw blocked)
   */
  getBlocked(limit: number = 50): AuditEntry[] {
    return this.readFile(this.blockedFile)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get allowed requests
   */
  getAllowed(limit: number = 50): AuditEntry[] {
    return this.readFile(this.allowedFile)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get warned requests
   */
  getWarned(limit: number = 50): AuditEntry[] {
    return this.readFile(this.warnedFile)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get audit statistics
   */
  getStats(hours: number = 24): AuditStats {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    const blocked = this.readFile(this.blockedFile).filter((e) => e.timestamp >= cutoff);
    const allowed = this.readFile(this.allowedFile).filter((e) => e.timestamp >= cutoff);
    const warned = this.readFile(this.warnedFile).filter((e) => e.timestamp >= cutoff);

    const totalSaved = blocked.reduce((sum, e) => sum + e.saved, 0);
    const totalWouldHaveLost = [...blocked, ...allowed].reduce((sum, e) => sum + e.wouldHaveLost, 0);

    // Category breakdown
    const byCategory: Record<string, number> = {};
    for (const e of [...blocked, ...allowed, ...warned]) {
      byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    }

    // Risk level breakdown
    const byRiskLevel: Record<string, number> = {};
    for (const e of [...blocked, ...allowed, ...warned]) {
      byRiskLevel[e.riskLevel] = (byRiskLevel[e.riskLevel] || 0) + 1;
    }

    return {
      totalBlocked: blocked.length,
      totalAllowed: allowed.length,
      totalWarned: warned.length,
      totalSaved: Math.round(totalSaved * 10000) / 10000,
      totalWouldHaveLost: Math.round(totalWouldHaveLost * 10000) / 10000,
      byCategory,
      byRiskLevel,
      recentBlocked: blocked.slice(0, 20),
      recentAllowed: allowed.slice(0, 20),
    };
  }

  /**
   * Clear all audit logs
   */
  clear(): void {
    this.writeFile(this.blockedFile, []);
    this.writeFile(this.allowedFile, []);
    this.writeFile(this.warnedFile, []);
  }

  /**
   * Export audit trail to file
   */
  export(filePath: string): boolean {
    try {
      const allEntries = this.query({});
      fs.writeFileSync(filePath, JSON.stringify(allEntries, null, 2));
      return true;
    } catch (e) {
      console.error('Error exporting audit trail:', e);
      return false;
    }
  }

  /**
   * Get audit directory path
   */
  getAuditDir(): string {
    return this.auditDir;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const auditTrail = AuditTrail.getInstance();
