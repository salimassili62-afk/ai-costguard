/**
 * StateStore.ts - Unified State Management
 *
 * Handles request history, hashing, privacy-safe persistence, scoped stats,
 * and fuzzy-match support for the single DetectionEngine.
 */

import { createHash } from 'crypto';
import { ConfigManager, PrivacyConfig } from '../config';
import { createStorageAdapter, StorageAdapter } from '../storage';
import { FirewallMetadata, TokenBreakdown } from './types';

export interface RequestRecord {
  id: string;
  timestamp: number;
  model: string;
  prompt: string;
  promptPreview?: string;
  promptHash: string;
  estimatedCost: number;
  actualCost?: number;
  dangerScore: number;
  isDangerous: boolean;
  category: string;
  wasBlocked: boolean;
  wasWarned: boolean;
  reason?: string;
  context?: string;
  metadata?: FirewallMetadata;
  tokens?: TokenBreakdown;
  decision?: 'allow' | 'warn' | 'block';
}

export interface StateStats {
  totalRequests: number;
  blockedRequests: number;
  warnedRequests: number;
  totalCost: number;
  preventedCost: number;
  actualCost: number;
  totalTokens: number;
}

export interface StatsFilter {
  windowMs?: number;
  metadata?: Partial<FirewallMetadata>;
  includeBlocked?: boolean;
}

/**
 * Unified StateStore - Singleton
 * All state lives here. All persistence happens here.
 */
export class StateStore {
  private static instance: StateStore;
  private cache: Map<string, RequestRecord[]> = new Map();
  private initialized = false;
  private config: ConfigManager;
  private storage: StorageAdapter<RequestRecord>;

  private constructor() {
    this.config = new ConfigManager();
    this.storage = createStorageAdapter<RequestRecord>(this.config.storage);
    this.initialize();
  }

  static getInstance(): StateStore {
    if (!StateStore.instance) {
      StateStore.instance = new StateStore();
    }
    return StateStore.instance;
  }

  private initialize(): void {
    if (this.initialized) return;
    this.loadHistory();
    this.initialized = true;
  }

  private loadHistory(): void {
    const retentionMs = this.config.privacy.retentionDays * 24 * 60 * 60 * 1000;
    let records: RequestRecord[] = [];

    try {
      records = this.storage.load();
    } catch {
      records = [];
    }

    for (const record of records) {
      if (Date.now() - record.timestamp >= retentionMs) {
        continue;
      }

      if (!this.cache.has(record.promptHash)) {
        this.cache.set(record.promptHash, []);
      }
      this.cache.get(record.promptHash)!.push(record);
    }
  }

  generateHash(prompt: string, context?: string): string {
    return createHash('sha256')
      .update(prompt + (context || ''))
      .digest('hex');
  }

  getRecentByHash(hash: string, windowMs: number = 30000): RequestRecord[] {
    const now = Date.now();
    const records = this.cache.get(hash) || [];
    return records.filter((r) => now - r.timestamp < windowMs);
  }

  getAllRecent(windowMs: number = 3600000): RequestRecord[] {
    const now = Date.now();
    const allRecords: RequestRecord[] = [];

    for (const records of this.cache.values()) {
      allRecords.push(...records.filter((r) => now - r.timestamp < windowMs));
    }

    return allRecords.sort((a, b) => b.timestamp - a.timestamp);
  }

  addRecord(record: RequestRecord): void {
    if (!this.cache.has(record.promptHash)) {
      this.cache.set(record.promptHash, []);
    }
    this.cache.get(record.promptHash)!.push(record);

    this.storage.append(this.toPersistentRecord(record));
  }

  getStats(hours: number = 24): StateStats {
    return this.getFilteredStats({
      windowMs: hours * 3600000,
      includeBlocked: true,
    });
  }

  getFilteredStats(filter: StatsFilter = {}): StateStats {
    const records = this.getFilteredRecords(filter);

    return {
      totalRequests: records.length,
      blockedRequests: records.filter((r) => r.wasBlocked).length,
      warnedRequests: records.filter((r) => r.wasWarned && !r.wasBlocked).length,
      totalCost: records.reduce((sum, r) => sum + r.estimatedCost, 0),
      preventedCost: records.filter((r) => r.wasBlocked).reduce((sum, r) => sum + r.estimatedCost, 0),
      actualCost: records.filter((r) => !r.wasBlocked).reduce((sum, r) => sum + (r.actualCost ?? r.estimatedCost), 0),
      totalTokens: records.reduce((sum, r) => sum + (r.tokens?.totalTokens || 0), 0),
    };
  }

  getBlocked(limit: number = 10): RequestRecord[] {
    return this.getAllRecent(86400000)
      .filter((r) => r.wasBlocked)
      .slice(0, limit);
  }

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
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
      }
    }

    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    return 1 - distance / maxLength;
  }

  clear(): void {
    this.cache.clear();
    this.storage.clear();
  }

  reload(): void {
    this.cache.clear();
    this.initialized = false;
    this.config = new ConfigManager();
    this.storage = createStorageAdapter<RequestRecord>(this.config.storage);
    this.initialize();
  }

  reset(): void {
    this.cache.clear();
    this.initialized = false;
    this.storage.clear();
    this.config = new ConfigManager();
    this.storage = createStorageAdapter<RequestRecord>(this.config.storage);
    this.initialize();
  }

  private getFilteredRecords(filter: StatsFilter = {}): RequestRecord[] {
    const windowMs = filter.windowMs ?? 24 * 60 * 60 * 1000;
    return this.getAllRecent(windowMs).filter((record) => {
      if (filter.includeBlocked === false && record.wasBlocked) {
        return false;
      }

      if (!filter.metadata) {
        return true;
      }

      return Object.entries(filter.metadata).every(([key, value]) => {
        if (value === undefined) return true;
        return record.metadata?.[key] === value;
      });
    });
  }

  private toPersistentRecord(record: RequestRecord): RequestRecord {
    const privacy = this.config.privacy;
    const prompt = this.sanitizeText(record.prompt, record.promptHash, privacy);
    const contextHash = record.context ? this.generateHash(record.context) : undefined;

    return {
      ...record,
      prompt,
      promptPreview: prompt,
      context: record.context
        ? this.sanitizeText(record.context, contextHash || record.promptHash, privacy)
        : undefined,
    };
  }

  private sanitizeText(value: string, hash: string, privacy: PrivacyConfig): string {
    if (privacy.promptStorage === 'plaintext') {
      return value;
    }

    if (privacy.promptStorage === 'hash') {
      return `[hash:${hash}]`;
    }

    let redacted = value;
    for (const pattern of privacy.redactPatterns) {
      try {
        redacted = redacted.replace(new RegExp(pattern, 'g'), '[redacted]');
      } catch {
        // Ignore invalid user-provided redaction patterns.
      }
    }
    return redacted;
  }
}

export const stateStore = StateStore.getInstance();
