import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface RequestRecord {
  id: string;
  hash: string;
  model: string;
  prompt: string;
  context?: string;
  estimatedCost: number;
  timestamp: number;
  wasBlocked: boolean;
  wasWarned: boolean;
  dangerScore: number;
  reason?: string;
}

export interface HistoryStats {
  totalRequests: number;
  blockedRequests: number;
  warnedRequests: number;
  totalCost: number;
  preventedCost: number;
  uniqueHashes: number;
}

/**
 * Efficient file-based history storage
 * Stores records in append-only JSONL format for performance
 */
export class HistoryStorage {
  private historyPath: string;
  private indexPath: string;
  private cache: Map<string, RequestRecord[]> = new Map();
  private lastCleanup: number = 0;
  private readonly CLEANUP_INTERVAL = 3600000; // 1 hour
  private readonly HISTORY_WINDOW = 86400000; // 24 hours

  constructor() {
    const homeDir = os.homedir();
    const storageDir = path.join(homeDir, '.ai-execution-firewall');
    
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    this.historyPath = path.join(storageDir, 'history.jsonl');
    this.indexPath = path.join(storageDir, 'index.json');
    
    this.loadIndex();
  }

  private loadIndex(): void {
    if (!fs.existsSync(this.indexPath)) {
      return;
    }

    try {
      const data = fs.readFileSync(this.indexPath, 'utf-8');
      const index = JSON.parse(data);
      
      // Load recent records into cache
      const now = Date.now();
      for (const hash in index) {
        const records = index[hash].filter((r: RequestRecord) => 
          now - r.timestamp < this.HISTORY_WINDOW
        );
        if (records.length > 0) {
          this.cache.set(hash, records);
        }
      }
    } catch (error) {
      console.warn('Failed to load history index, starting fresh');
    }
  }

  private saveIndex(): void {
    const index: Record<string, RequestRecord[]> = {};
    for (const [hash, records] of this.cache.entries()) {
      index[hash] = records;
    }
    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2));
  }

  public cleanupOldRecords(): void {
    const now = Date.now();
    
    // Clean up cache
    for (const [hash, records] of this.cache.entries()) {
      const filtered = records.filter(r => now - r.timestamp < this.HISTORY_WINDOW);
      if (filtered.length === 0) {
        this.cache.delete(hash);
      } else {
        this.cache.set(hash, filtered);
      }
    }

    // Clean up file periodically
    if (now - this.lastCleanup > this.CLEANUP_INTERVAL) {
      this.cleanupFile();
      this.lastCleanup = now;
    }

    this.saveIndex();
  }

  private cleanupFile(): void {
    if (!fs.existsSync(this.historyPath)) {
      return;
    }

    const now = Date.now();
    const lines = fs.readFileSync(this.historyPath, 'utf-8').split('\n');
    const validLines = lines.filter(line => {
      if (!line.trim()) return false;
      try {
        const record = JSON.parse(line);
        return now - record.timestamp < this.HISTORY_WINDOW * 7; // Keep 7 days
      } catch {
        return false;
      }
    });

    fs.writeFileSync(this.historyPath, validLines.join('\n'));
  }

  addRecord(record: RequestRecord): void {
    // Append to file
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(this.historyPath, line);

    // Update cache
    if (!this.cache.has(record.hash)) {
      this.cache.set(record.hash, []);
    }
    this.cache.get(record.hash)!.push(record);

    // Periodic cleanup
    this.cleanupOldRecords();
  }

  getRecentRecords(hash: string, windowMs: number = 30000): RequestRecord[] {
    const now = Date.now();
    const records = this.cache.get(hash) || [];
    return records.filter(r => now - r.timestamp < windowMs);
  }

  getRecordsInWindow(windowMs: number = 3600000): RequestRecord[] {
    const now = Date.now();
    const allRecords: RequestRecord[] = [];
    
    for (const records of this.cache.values()) {
      allRecords.push(...records.filter(r => now - r.timestamp < windowMs));
    }

    return allRecords.sort((a, b) => b.timestamp - a.timestamp);
  }

  getStats(hours: number = 24): HistoryStats {
    const windowMs = hours * 3600000;
    const records = this.getRecordsInWindow(windowMs);

    const stats: HistoryStats = {
      totalRequests: records.length,
      blockedRequests: records.filter(r => r.wasBlocked).length,
      warnedRequests: records.filter(r => r.wasWarned).length,
      totalCost: records.reduce((sum, r) => sum + r.estimatedCost, 0),
      preventedCost: records.filter(r => r.wasBlocked).reduce((sum, r) => sum + r.estimatedCost, 0),
      uniqueHashes: new Set(records.map(r => r.hash)).size,
    };

    return stats;
  }

  getBlockedRequests(limit: number = 10): RequestRecord[] {
    const records = this.getRecordsInWindow(86400000);
    return records
      .filter(r => r.wasBlocked)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  destroy(): void {
    this.cache.clear();
    this.saveIndex();
  }
}
