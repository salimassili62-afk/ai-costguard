/**
 * AECL - Execution Memory Layer
 * 
 * Stores ONLY:
 * - Hashed execution traces (no raw prompts)
 * - Cost metrics per session
 * - Loop signatures for deduplication
 * 
 * DESIGN:
 * - In-memory with optional persistence
 * - Automatic TTL eviction (1 hour default)
 * - Fixed memory budget (no unbounded growth)
 */

import { createHash } from 'crypto';

export interface ExecutionTrace {
  sessionId: string;
  stepNumber: number;
  operation: string;
  inputHash: string;      // SHA256 of input (not content)
  outputHash?: string;    // SHA256 of output (not content)
  cost: number;
  tokens: number;
  timestamp: number;
  durationMs: number;
}

export interface SessionMemory {
  sessionId: string;
  startTime: number;
  traces: ExecutionTrace[];
  totalCost: number;
  totalTokens: number;
  stepCount: number;
  lastActivity: number;
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  previousOccurrences: number;
  similarTraces: ExecutionTrace[];
}

/**
 * Execution Memory
 * 
 * In-memory storage with TTL eviction.
 * No raw data stored - only hashes and metrics.
 */
export class ExecutionMemory {
  private sessions: Map<string, SessionMemory>;
  private maxSessions: number;
  private ttlMs: number;
  private maxTracesPerSession: number;

  constructor(config?: { 
    maxSessions?: number; 
    ttlMinutes?: number;
    maxTracesPerSession?: number;
  }) {
    this.sessions = new Map();
    this.maxSessions = config?.maxSessions || 10000;
    this.ttlMs = (config?.ttlMinutes || 60) * 60 * 1000;
    this.maxTracesPerSession = config?.maxTracesPerSession || 100;

    // Start cleanup interval
    setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Record execution trace
   */
  record(trace: ExecutionTrace): void {
    let session = this.sessions.get(trace.sessionId);

    if (!session) {
      // Check if we need to evict
      if (this.sessions.size >= this.maxSessions) {
        this.evictOldest();
      }

      session = {
        sessionId: trace.sessionId,
        startTime: trace.timestamp,
        traces: [],
        totalCost: 0,
        totalTokens: 0,
        stepCount: 0,
        lastActivity: trace.timestamp,
      };
      this.sessions.set(trace.sessionId, session);
    }

    // Add trace
    session.traces.push(trace);
    session.totalCost += trace.cost;
    session.totalTokens += trace.tokens;
    session.stepCount++;
    session.lastActivity = trace.timestamp;

    // Limit trace history
    if (session.traces.length > this.maxTracesPerSession) {
      session.traces.shift();
    }
  }

  /**
   * Check for deduplication
   * Returns count of similar traces in session
   */
  checkDeduplication(sessionId: string, inputHash: string, operation: string): DeduplicationResult {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { isDuplicate: false, previousOccurrences: 0, similarTraces: [] };
    }

    const matches = session.traces.filter(t => 
      t.inputHash === inputHash && t.operation === operation
    );

    return {
      isDuplicate: matches.length > 0,
      previousOccurrences: matches.length,
      similarTraces: matches.slice(-5), // Last 5 matches
    };
  }

  /**
   * Get session metrics
   */
  getSession(sessionId: string): SessionMemory | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all session IDs
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Clear session (on completion or error)
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Get global stats
   */
  getStats(): {
    activeSessions: number;
    totalTraces: number;
    totalCost: number;
    avgTracesPerSession: number;
  } {
    let totalTraces = 0;
    let totalCost = 0;

    for (const session of this.sessions.values()) {
      totalTraces += session.traces.length;
      totalCost += session.totalCost;
    }

    const sessionCount = this.sessions.size;

    return {
      activeSessions: sessionCount,
      totalTraces,
      totalCost,
      avgTracesPerSession: sessionCount > 0 ? totalTraces / sessionCount : 0,
    };
  }

  /**
   * Hash content (for input/output hashing)
   */
  hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').substring(0, 32);
  }

  /**
   * Cleanup expired sessions
   */
  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > this.ttlMs) {
        expired.push(sessionId);
      }
    }

    for (const sessionId of expired) {
      this.sessions.delete(sessionId);
    }

    if (expired.length > 0) {
      console.log(`[AECL] Cleaned up ${expired.length} expired sessions`);
    }
  }

  /**
   * Evict oldest session when at capacity
   */
  private evictOldest(): void {
    let oldest: { id: string; time: number } | null = null;

    for (const [sessionId, session] of this.sessions) {
      if (!oldest || session.lastActivity < oldest.time) {
        oldest = { id: sessionId, time: session.lastActivity };
      }
    }

    if (oldest) {
      this.sessions.delete(oldest.id);
    }
  }

  /**
   * Reset (for testing)
   */
  reset(): void {
    this.sessions.clear();
  }
}

export const executionMemory = new ExecutionMemory();
