/**
 * SessionStats.ts - Session-level aggregation
 * 
 * Tracks per run / per 24h:
 * - total requests
 * - total blocked
 * - total saved
 * - total spent
 * 
 * Persists session stats locally
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SessionStats {
  sessionId: string;
  startTime: number;
  endTime?: number;
  totalRequests: number;
  totalBlocked: number;
  totalAllowed: number;
  totalWarned: number;
  totalSaved: number;
  totalSpent: number;
  totalWouldHaveLost: number;
  requests: {
    timestamp: number;
    decision: 'ALLOW' | 'BLOCK' | 'WARN';
    cost: number;
    saved: number;
  }[];
}

export interface DailyStats {
  date: string;
  totalRequests: number;
  totalBlocked: number;
  totalSaved: number;
  totalSpent: number;
  totalWouldHaveLost: number;
}

/**
 * SessionStats - Singleton
 * Tracks session-level statistics
 */
export class SessionStatsManager {
  private static instance: SessionStatsManager;
  private statsDir: string;
  private sessionFile: string;
  private dailyFile: string;
  private currentSession: SessionStats;

  private constructor() {
    this.statsDir = path.join(os.homedir(), '.ai-execution-firewall', 'stats');
    this.sessionFile = path.join(this.statsDir, 'session.json');
    this.dailyFile = path.join(this.statsDir, 'daily.json');
    this.ensureDirectory();
    this.currentSession = this.loadSession();
  }

  static getInstance(): SessionStatsManager {
    if (!SessionStatsManager.instance) {
      SessionStatsManager.instance = new SessionStatsManager();
    }
    return SessionStatsManager.instance;
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.statsDir)) {
      fs.mkdirSync(this.statsDir, { recursive: true });
    }
  }

  private loadSession(): SessionStats {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const data = fs.readFileSync(this.sessionFile, 'utf8');
        const session = JSON.parse(data);
        
        // Start new session if it's been more than 24 hours
        if (Date.now() - session.startTime > 24 * 60 * 60 * 1000) {
          return this.createNewSession();
        }
        
        return session;
      }
    } catch (e) {
      console.error('Error loading session stats:', e);
    }
    return this.createNewSession();
  }

  private createNewSession(): SessionStats {
    return {
      sessionId: this.generateSessionId(),
      startTime: Date.now(),
      totalRequests: 0,
      totalBlocked: 0,
      totalAllowed: 0,
      totalWarned: 0,
      totalSaved: 0,
      totalSpent: 0,
      totalWouldHaveLost: 0,
      requests: [],
    };
  }

  private saveSession(): void {
    try {
      this.ensureDirectory();
      fs.writeFileSync(this.sessionFile, JSON.stringify(this.currentSession, null, 2));
    } catch (e) {
      console.error('Error saving session stats:', e);
    }
  }

  /**
   * Record a request
   */
  recordRequest(params: {
    decision: 'ALLOW' | 'BLOCK' | 'WARN';
    cost: number;
    saved: number;
    wouldHaveLost: number;
  }): void {
    this.currentSession.totalRequests++;
    this.currentSession.totalWouldHaveLost += params.wouldHaveLost;

    if (params.decision === 'BLOCK') {
      this.currentSession.totalBlocked++;
      this.currentSession.totalSaved += params.saved;
    } else if (params.decision === 'ALLOW') {
      this.currentSession.totalAllowed++;
      this.currentSession.totalSpent += params.cost;
    } else if (params.decision === 'WARN') {
      this.currentSession.totalWarned++;
      this.currentSession.totalSpent += params.cost;
    }

    this.currentSession.requests.push({
      timestamp: Date.now(),
      decision: params.decision,
      cost: params.cost,
      saved: params.saved,
    });

    // Keep only last 1000 requests
    if (this.currentSession.requests.length > 1000) {
      this.currentSession.requests = this.currentSession.requests.slice(-1000);
    }

    this.saveSession();
    this.updateDailyStats(params);
  }

  /**
   * Update daily stats
   */
  private updateDailyStats(params: {
    decision: 'ALLOW' | 'BLOCK' | 'WARN';
    cost: number;
    saved: number;
    wouldHaveLost: number;
  }): void {
    const today = new Date().toISOString().split('T')[0];
    const dailyStats = this.loadDailyStats();

    if (!dailyStats[today]) {
      dailyStats[today] = {
        date: today,
        totalRequests: 0,
        totalBlocked: 0,
        totalSaved: 0,
        totalSpent: 0,
        totalWouldHaveLost: 0,
      };
    }

    const day = dailyStats[today];
    day.totalRequests++;
    day.totalWouldHaveLost += params.wouldHaveLost;

    if (params.decision === 'BLOCK') {
      day.totalBlocked++;
      day.totalSaved += params.saved;
    } else {
      day.totalSpent += params.cost;
    }

    // Keep only last 30 days
    const dates = Object.keys(dailyStats).sort().reverse();
    if (dates.length > 30) {
      const toDelete = dates.slice(30);
      toDelete.forEach(d => delete dailyStats[d]);
    }

    this.saveDailyStats(dailyStats);
  }

  private loadDailyStats(): Record<string, DailyStats> {
    try {
      if (fs.existsSync(this.dailyFile)) {
        return JSON.parse(fs.readFileSync(this.dailyFile, 'utf8'));
      }
    } catch (e) {
      console.error('Error loading daily stats:', e);
    }
    return {};
  }

  private saveDailyStats(stats: Record<string, DailyStats>): void {
    try {
      this.ensureDirectory();
      fs.writeFileSync(this.dailyFile, JSON.stringify(stats, null, 2));
    } catch (e) {
      console.error('Error saving daily stats:', e);
    }
  }

  /**
   * Get current session stats
   */
  getSessionStats(): SessionStats {
    return { ...this.currentSession };
  }

  /**
   * Get daily stats for a date range
   */
  getDailyStats(days: number = 7): DailyStats[] {
    const dailyStats = this.loadDailyStats();
    const dates = Object.keys(dailyStats).sort().reverse().slice(0, days);
    return dates.map(d => dailyStats[d]);
  }

  /**
   * Get summary for display
   */
  getSummary(hours: number = 24): {
    period: string;
    totalRequests: number;
    totalBlocked: number;
    totalAllowed: number;
    totalSaved: number;
    totalSpent: number;
    totalWouldHaveLost: number;
    protectionRate: number;
  } {
    const session = this.currentSession;
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    
    // Filter requests within time window
    const recentRequests = session.requests.filter(r => r.timestamp >= cutoff);
    
    const totalRequests = recentRequests.length;
    const totalBlocked = recentRequests.filter(r => r.decision === 'BLOCK').length;
    const totalAllowed = recentRequests.filter(r => r.decision === 'ALLOW').length;
    
    const totalSaved = recentRequests.reduce((sum, r) => sum + r.saved, 0);
    const totalSpent = recentRequests.reduce((sum, r) => sum + r.cost, 0);
    const totalWouldHaveLost = totalSaved + totalSpent;
    
    const protectionRate = totalRequests > 0
      ? (totalBlocked / totalRequests) * 100
      : 0;

    return {
      period: `${hours}h`,
      totalRequests,
      totalBlocked,
      totalAllowed,
      totalSaved: Math.round(totalSaved * 100) / 100,
      totalSpent: Math.round(totalSpent * 100) / 100,
      totalWouldHaveLost: Math.round(totalWouldHaveLost * 100) / 100,
      protectionRate: Math.round(protectionRate * 100) / 100,
    };
  }

  /**
   * Clear current session
   */
  clearSession(): void {
    this.currentSession = this.createNewSession();
    this.saveSession();
  }

  /**
   * Get stats directory path
   */
  getStatsDir(): string {
    return this.statsDir;
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const sessionStats = SessionStatsManager.getInstance();
