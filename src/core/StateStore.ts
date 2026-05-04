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
import { performance } from 'perf_hooks';

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
const REDIS_HISTORY_KEY = 'aifw:history';
const HISTORY_RETENTION_MS = 86400000;

interface StatePersistence {
  name: 'file' | 'redis';
  initialize(): Promise<void> | void;
  append(record: RequestRecord): Promise<void> | void;
  load(): Promise<RequestRecord[]> | RequestRecord[];
  clear(): Promise<void> | void;
}

class FilePersistence implements StatePersistence {
  name: 'file' = 'file';

  initialize(): void {
    if (!fs.existsSync(AIFW_DIR)) {
      fs.mkdirSync(AIFW_DIR, { recursive: true });
    }
  }

  load(): RequestRecord[] {
    if (!fs.existsSync(HISTORY_FILE)) {
      return [];
    }
    const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n');
    const records: RequestRecord[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record: RequestRecord = JSON.parse(line);
        records.push(record);
      } catch {
        // skip corrupted line
      }
    }
    return records;
  }

  append(record: RequestRecord): void {
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(record) + '\n');
  }

  clear(): void {
    if (fs.existsSync(HISTORY_FILE)) {
      fs.unlinkSync(HISTORY_FILE);
    }
  }
}

type RedisClientLike = {
  isOpen?: boolean;
  connect: () => Promise<void>;
  lRange: (key: string, start: number, stop: number) => Promise<string[]>;
  rPush: (key: string, value: string) => Promise<number>;
  del: (key: string) => Promise<number>;
};

class RedisPersistence implements StatePersistence {
  name: 'redis' = 'redis';
  private client: RedisClientLike | null = null;
  private readonly fallback = new FilePersistence();
  private ready = false;

  async initialize(): Promise<void> {
    this.fallback.initialize();
    try {
      // Optional dependency: if missing or unavailable, fallback to file persistence.
      const redisModule = require('redis') as {
        createClient: (opts: { url: string }) => RedisClientLike;
      };
      const url = process.env.REDIS_URL;
      if (!url) {
        return;
      }
      this.client = redisModule.createClient({ url });
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  async load(): Promise<RequestRecord[]> {
    if (!this.ready || !this.client) {
      return this.fallback.load();
    }
    try {
      const lines = await this.client.lRange(REDIS_HISTORY_KEY, 0, -1);
      const records: RequestRecord[] = [];
      for (const line of lines) {
        try {
          records.push(JSON.parse(line));
        } catch {
          // skip malformed redis entries
        }
      }
      return records;
    } catch {
      return this.fallback.load();
    }
  }

  append(record: RequestRecord): void {
    // Always persist to local file for fallback and observability.
    this.fallback.append(record);
    if (!this.ready || !this.client) {
      return;
    }
    void this.client.rPush(REDIS_HISTORY_KEY, JSON.stringify(record)).catch(() => undefined);
  }

  clear(): void {
    this.fallback.clear();
    if (!this.ready || !this.client) {
      return;
    }
    void this.client.del(REDIS_HISTORY_KEY).catch(() => undefined);
  }
}

/**
 * Unified StateStore - Singleton
 * All state lives here. All persistence happens here.
 */
export class StateStore {
  private static instance: StateStore;
  private cache: Map<string, RequestRecord[]> = new Map();
  private initialized = false;
  private readonly persistence: StatePersistence;

  private constructor() {
    this.persistence = this.createPersistence();
    void this.initialize();
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
    this.persistence.initialize();
    void this.loadHistory();
    this.initialized = true;
  }

  /**
   * Load all history from disk into memory cache
   */
  private async loadHistory(): Promise<void> {
    const records = await this.persistence.load();
    const now = Date.now();
    for (const record of records) {
      if (now - record.timestamp >= HISTORY_RETENTION_MS) {
        continue;
      }
      if (!this.cache.has(record.promptHash)) {
        this.cache.set(record.promptHash, []);
      }
      this.cache.get(record.promptHash)!.push(record);
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

    this.persistence.append(record);
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
    this.persistence.clear();
  }

  /**
   * Reload state from disk (for testing)
   */
  reload(): void {
    this.cache.clear();
    this.initialized = false;
    this.initialize();
  }

  /**
   * Reset for testing - fully restore initial state
   */
  reset(): void {
    this.cache.clear();
    this.initialized = false;
    this.persistence.clear();
    this.initialize();
  }

  getPersistenceMode(): 'file' | 'redis' {
    return this.persistence.name;
  }

  private createPersistence(): StatePersistence {
    const mode = (process.env.AIFW_STORAGE_BACKEND || 'file').toLowerCase();
    if (mode === 'redis') {
      return new RedisPersistence();
    }
    return new FilePersistence();
  }

  getOperationalMetrics(hours: number = 24): {
    total_cost_saved: number;
    blocked_requests_count: number;
    false_positive_indicator: number;
    avg_analysis_latency_ms: number;
    storage_backend: 'file' | 'redis';
  } {
    const start = performance.now();
    const stats = this.getStats(hours);
    const falsePositiveIndicator =
      stats.warnedRequests > 0
        ? Number((stats.warnedRequests / Math.max(1, stats.warnedRequests + stats.blockedRequests)).toFixed(4))
        : 0;
    return {
      total_cost_saved: Number(stats.preventedCost.toFixed(4)),
      blocked_requests_count: stats.blockedRequests,
      false_positive_indicator: falsePositiveIndicator,
      avg_analysis_latency_ms: Number((performance.now() - start).toFixed(4)),
      storage_backend: this.persistence.name,
    };
  }
}

// Export singleton instance
export const stateStore = StateStore.getInstance();
