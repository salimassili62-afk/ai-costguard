/**
 * CLI Persistent Storage Module
 * Ensures state persists across separate CLI executions
 * Uses ~/.aifw/history.jsonl for append-only storage
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CLIRequestRecord {
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
}

export interface CLIDetectionResult {
  isDangerous: boolean;
  dangerScore: number;
  category: string;
  reason: string;
  action: 'allow' | 'warn' | 'block';
}

const AIFW_DIR = path.join(os.homedir(), '.aifw');
const HISTORY_FILE = path.join(AIFW_DIR, 'history.jsonl');

/**
 * Ensure storage directory exists
 */
function ensureStorage(): void {
  if (!fs.existsSync(AIFW_DIR)) {
    fs.mkdirSync(AIFW_DIR, { recursive: true });
  }
}

/**
 * Load all request history from file
 */
export function loadRequestHistory(): CLIRequestRecord[] {
  ensureStorage();

  if (!fs.existsSync(HISTORY_FILE)) {
    return [];
  }

  const records: CLIRequestRecord[] = [];
  const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      records.push(record);
    } catch {
      // Skip invalid lines
    }
  }

  return records;
}

/**
 * Get recent requests by hash (for duplicate detection)
 */
export function getRecentRequestsByHash(hash: string, windowMs: number = 30000): CLIRequestRecord[] {
  const now = Date.now();
  const allRecords = loadRequestHistory();

  return allRecords.filter((r) => r.promptHash === hash && now - r.timestamp < windowMs);
}

/**
 * Get all recent requests (for fuzzy detection)
 */
export function getRecentRequests(windowMs: number = 3600000): CLIRequestRecord[] {
  const now = Date.now();
  const allRecords = loadRequestHistory();

  return allRecords.filter((r) => now - r.timestamp < windowMs);
}

/**
 * Append a request to persistent storage
 */
export function appendRequest(record: CLIRequestRecord): void {
  ensureStorage();
  const line = JSON.stringify(record) + '\n';
  fs.appendFileSync(HISTORY_FILE, line);
}

/**
 * Get CLI statistics
 */
export function getCLIStats(hours: number = 24): {
  totalRequests: number;
  blockedRequests: number;
  warnedRequests: number;
  totalCost: number;
  preventedCost: number;
} {
  const windowMs = hours * 3600000;
  const now = Date.now();
  const records = loadRequestHistory().filter((r) => now - r.timestamp < windowMs);

  return {
    totalRequests: records.length,
    blockedRequests: records.filter((r) => r.wasBlocked).length,
    warnedRequests: records.filter((r) => r.wasWarned && !r.wasBlocked).length,
    totalCost: records.reduce((sum, r) => sum + r.estimatedCost, 0),
    preventedCost: records.filter((r) => r.wasBlocked).reduce((sum, r) => sum + r.estimatedCost, 0),
  };
}

/**
 * Get blocked requests for display
 */
export function getBlockedRequests(limit: number = 10): CLIRequestRecord[] {
  const windowMs = 24 * 3600000; // 24 hours
  const now = Date.now();

  return loadRequestHistory()
    .filter((r) => r.wasBlocked && now - r.timestamp < windowMs)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

/**
 * Clear all history (for testing)
 */
export function clearHistory(): void {
  if (fs.existsSync(HISTORY_FILE)) {
    fs.unlinkSync(HISTORY_FILE);
  }
}
