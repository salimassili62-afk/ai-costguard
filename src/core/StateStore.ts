/**
 * StateStore.ts - Unified State Management
 * 
 * This is the SINGLE source of truth for all state in AI Execution Firewall.
 * Handles: request history, hashing, persistence (file-based)
 * Used ONLY by DetectionEngine - no direct access from CLI/SDK/Proxy
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';

export interface RequestRecord {
  id: string;
  timestamp: number;
  model: string;
  prompt: string;
  promptHash: string;
  estimatedCost: number;
  dangerScore: number;
  isDangerous: boolean;
  category: string;
  wasBlocked: boolean;
  wasWarned: boolean;
  reason?: string;
  context?: string;
}

export interface StateStats {
  totalRequests: number;
  blockedRequests: number;
  warnedRequests: number;
  totalCost: number;
  preventedCost: number;
}

const AIFW_DIR = path.join(os.homedir(), '.aifw');
const HISTORY_FILE = path.join(AIFW_DIR, 'history.jsonl');

/**
 * Unified StateStore - Singleton
 * All state lives here. All persistence happens here.
 */
export class StateStore {
  private static instance: StateStore;
  private cache: Map<string, RequestRecord[]> = new Map();
  private initialized = false;

  private constructor() {
    this.initialize();
  }

  static getInstance(): StateStore {
    if (!StateStore.instance) {
      StateStore.instance = new StateStore();
    }
    return StateStore.instance;
  }

  /**
   * Initialize storage directory and load existing history
   */
  private initialize(): void {
    if (this.initialized) return;

    // Ensure directory exists
    if (!fs.existsSync(AIFW_DIR)) {
      fs.mkdirSync(AIFW_DIR, { recursive: true });
    }

    // Load existing history into cache
    this.loadHistory();
    this.initialized = true;
  }

  /**
   * Load all history from disk into memory cache
   */
  private loadHistory(): void {
    if (!fs.existsSync(HISTORY_FILE)) {
      return;
    }

    const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record: RequestRecord = JSON.parse(line);
        // Only load records from last 24 hours
        if (Date.now() - record.timestamp < 86400000) {
          if (!this.cache.has(record.promptHash)) {
            this.cache.set(record.promptHash, []);
          }
          this.cache.get(record.promptHash)!.push(record);
        }
      } catch {
        // Skip invalid lines
      }
    }
  }

  /**
   * Generate hash for prompt + context
   */
  generateHash(prompt: string, context?: string): string {
    return createHash('sha256').update(prompt + (context || '')).digest('hex');
  }

  /**
   * Get recent requests by hash within time window
   */
  getRecentByHash(hash: string, windowMs: number = 30000): RequestRecord[] {
    const now = Date.now();
    const records = this.cache.get(hash) || [];
    return records.filter(r => (now - r.timestamp) < windowMs);
  }

  /**
   * Get all recent requests within time window
   */
  getAllRecent(windowMs: number = 3600000): RequestRecord[] {
    const now = Date.now();
    const allRecords: RequestRecord[] = [];
    
    for (const records of this.cache.values()) {
      allRecords.push(...records.filter(r => (now - r.timestamp) < windowMs));
    }
    
    return allRecords.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Add a record to state (memory + disk)
   */
  addRecord(record: RequestRecord): void {
    // Add to cache
    if (!this.cache.has(record.promptHash)) {
      this.cache.set(record.promptHash, []);
    }
    this.cache.get(record.promptHash)!.push(record);

    // Append to disk (append-only for performance)
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(HISTORY_FILE, line);
  }

  /**
   * Get statistics for time window
   */
  getStats(hours: number = 24): StateStats {
    const windowMs = hours * 3600000;
    const now = Date.now();
    const records = this.getAllRecent(windowMs);

    return {
      totalRequests: records.length,
      blockedRequests: records.filter(r => r.wasBlocked).length,
      warnedRequests: records.filter(r => r.wasWarned && !r.wasBlocked).length,
      totalCost: records.reduce((sum, r) => sum + r.estimatedCost, 0),
      preventedCost: records.filter(r => r.wasBlocked).reduce((sum, r) => sum + r.estimatedCost, 0),
    };
  }

  /**
   * Get blocked requests
   */
  getBlocked(limit: number = 10): RequestRecord[] {
    return this.getAllRecent(86400000)
      .filter(r => r.wasBlocked)
      .slice(0, limit);
  }

  /**
   * Calculate similarity between two strings (Levenshtein)
   */
  calculateSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const len1 = Math.min(str1.length, 500);
    const len2 = Math.min(str2.length, 500);
    const s1 = str1.substring(0, len1);
    const s2 = str2.substring(0, len2);

    const matrix: number[][] = [];
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    return 1 - distance / maxLength;
  }

  /**
   * Clear all history (for testing)
   */
  clear(): void {
    this.cache.clear();
    if (fs.existsSync(HISTORY_FILE)) {
      fs.unlinkSync(HISTORY_FILE);
    }
  }

  /**
   * Reset for testing
   */
  reset(): void {
    this.cache.clear();
    this.initialized = false;
    this.initialize();
  }
}

// Export singleton instance
export const stateStore = StateStore.getInstance();
