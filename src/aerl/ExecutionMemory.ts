/**
 * AERL - Execution Memory Layer
 * 
 * Stores hashed execution data for pattern recognition:
 * - Hashed execution traces (no raw prompts)
 * - Failure patterns
 * - Loop signatures
 * - Success/failure sequences
 * 
 * PURPOSE: Improve future reliability decisions without storing sensitive data
 * 
 * REQUIREMENTS:
 * - No raw sensitive data stored
 * - In-memory with TTL
 * - Fixed memory budget
 * - Pattern lookup in <1ms
 */

import { createHash } from 'crypto';

export interface ExecutionTrace {
  traceId: string;
  sessionId: string;
  workflowId: string;
  stepNumber: number;
  operation: string;
  inputHash: string;      // SHA256 of input
  outputHash?: string;      // SHA256 of output
  cost: number;
  tokens: number;
  durationMs: number;
  timestamp: number;
  success: boolean;
  failureType?: string;
}

export interface FailurePattern {
  patternId: string;
  signature: string;        // Hash of failure characteristics
  operation: string;
  failureType: string;
  occurrenceCount: number;
  lastSeen: number;
  avgCostBeforeFailure: number;
  avgStepsBeforeFailure: number;
}

export interface LoopSignature {
  loopId: string;
  signature: string;        // Hash of the loop pattern
  nodeSequence: string[];   // Hashed node IDs in loop
  occurrenceCount: number;
  lastSeen: number;
}

export interface SuccessSequence {
  sequenceId: string;
  signature: string;        // Hash of successful operation sequence
  operations: string[];
  avgCost: number;
  avgDurationMs: number;
  occurrenceCount: number;
  lastSeen: number;          // For TTL eviction
}

export class ExecutionMemory {
  private traces: Map<string, ExecutionTrace[]>;      // sessionId -> traces
  private failurePatterns: Map<string, FailurePattern>;
  private loopSignatures: Map<string, LoopSignature>;
  private successSequences: Map<string, SuccessSequence>;
  
  private maxTracesPerSession: number;
  private maxPatterns: number;
  private ttlMs: number;

  constructor(config?: {
    maxTracesPerSession?: number;
    maxPatterns?: number;
    ttlMinutes?: number;
  }) {
    this.traces = new Map();
    this.failurePatterns = new Map();
    this.loopSignatures = new Map();
    this.successSequences = new Map();
    
    this.maxTracesPerSession = config?.maxTracesPerSession || 100;
    this.maxPatterns = config?.maxPatterns || 1000;
    this.ttlMs = (config?.ttlMinutes || 60) * 60 * 1000;

    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Record execution trace
   */
  recordTrace(trace: ExecutionTrace): void {
    let sessionTraces = this.traces.get(trace.sessionId);
    if (!sessionTraces) {
      sessionTraces = [];
      this.traces.set(trace.sessionId, sessionTraces);
    }

    sessionTraces.push(trace);
    
    // Limit traces per session
    if (sessionTraces.length > this.maxTracesPerSession) {
      sessionTraces.shift();
    }

    // Index by pattern if failure
    if (!trace.success && trace.failureType) {
      this.indexFailurePattern(trace);
    }
  }

  /**
   * Record loop signature
   */
  recordLoop(workflowId: string, nodeHashes: string[]): void {
    const signature = this.hashLoop(nodeHashes);
    const existing = this.loopSignatures.get(signature);

    if (existing) {
      existing.occurrenceCount++;
      existing.lastSeen = Date.now();
    } else {
      this.loopSignatures.set(signature, {
        loopId: `loop-${signature.substring(0, 8)}`,
        signature,
        nodeSequence: nodeHashes,
        occurrenceCount: 1,
        lastSeen: Date.now(),
      });
    }

    // Evict old patterns if at capacity
    if (this.loopSignatures.size > this.maxPatterns) {
      this.evictOldest(this.loopSignatures);
    }
  }

  /**
   * Record success sequence for future optimization
   */
  recordSuccessSequence(sessionId: string, operations: string[], avgCost: number, avgDuration: number): void {
    const signature = this.hashSequence(operations);
    const existing = this.successSequences.get(signature);

    if (existing) {
      existing.occurrenceCount++;
      existing.lastSeen = Date.now();
      // Update averages
      const n = existing.occurrenceCount;
      existing.avgCost = (existing.avgCost * (n - 1) + avgCost) / n;
      existing.avgDurationMs = (existing.avgDurationMs * (n - 1) + avgDuration) / n;
    } else {
      this.successSequences.set(signature, {
        sequenceId: `seq-${signature.substring(0, 8)}`,
        signature,
        operations: [...operations],
        avgCost,
        avgDurationMs: avgDuration,
        occurrenceCount: 1,
        lastSeen: Date.now(),
      });
    }
  }

  /**
   * Check if input hash matches known failure pattern
   */
  checkFailureRisk(operation: string, inputHash: string): {
    riskScore: number;
    similarFailures: number;
    avgCostBeforeFailure: number;
  } {
    let matches = 0;
    let totalCost = 0;

    for (const pattern of this.failurePatterns.values()) {
      if (pattern.operation === operation) {
        // Simple similarity: check if hashes share prefix
        if (inputHash.substring(0, 8) === pattern.signature.substring(0, 8)) {
          matches++;
          totalCost += pattern.avgCostBeforeFailure;
        }
      }
    }

    const riskScore = Math.min(1, matches / 5); // 5+ similar failures = high risk
    const avgCost = matches > 0 ? totalCost / matches : 0;

    return {
      riskScore,
      similarFailures: matches,
      avgCostBeforeFailure: avgCost,
    };
  }

  /**
   * Check if loop pattern exists
   */
  checkLoopPattern(nodeHashes: string[]): {
    isKnownLoop: boolean;
    occurrenceCount: number;
  } {
    const signature = this.hashLoop(nodeHashes);
    const pattern = this.loopSignatures.get(signature);

    return {
      isKnownLoop: !!pattern,
      occurrenceCount: pattern?.occurrenceCount || 0,
    };
  }

  /**
   * Get session traces
   */
  getSessionTraces(sessionId: string): ExecutionTrace[] {
    return this.traces.get(sessionId) || [];
  }

  /**
   * Get recommended approach based on success sequences
   */
  getRecommendedApproach(operations: string[]): {
    hasRecommendation: boolean;
    avgCost: number;
    avgDurationMs: number;
    confidence: number;
  } {
    const signature = this.hashSequence(operations);
    const sequence = this.successSequences.get(signature);

    if (!sequence) {
      return {
        hasRecommendation: false,
        avgCost: 0,
        avgDurationMs: 0,
        confidence: 0,
      };
    }

    // Confidence based on occurrence count
    const confidence = Math.min(0.95, sequence.occurrenceCount / 10);

    return {
      hasRecommendation: true,
      avgCost: sequence.avgCost,
      avgDurationMs: sequence.avgDurationMs,
      confidence,
    };
  }

  private indexFailurePattern(trace: ExecutionTrace): void {
    // Create signature from operation + input prefix
    const signature = createHash('sha256')
      .update(`${trace.operation}:${trace.inputHash.substring(0, 16)}`)
      .digest('hex')
      .substring(0, 32);

    const existing = this.failurePatterns.get(signature);
    
    if (existing) {
      existing.occurrenceCount++;
      existing.lastSeen = Date.now();
      // Update averages
      const sessionTraces = this.traces.get(trace.sessionId) || [];
      const stepsBefore = sessionTraces.filter(t => t.timestamp < trace.timestamp).length;
      const costBefore = sessionTraces
        .filter(t => t.timestamp < trace.timestamp)
        .reduce((sum, t) => sum + t.cost, 0);
      
      const n = existing.occurrenceCount;
      existing.avgStepsBeforeFailure = (existing.avgStepsBeforeFailure * (n - 1) + stepsBefore) / n;
      existing.avgCostBeforeFailure = (existing.avgCostBeforeFailure * (n - 1) + costBefore) / n;
    } else {
      const sessionTraces = this.traces.get(trace.sessionId) || [];
      const stepsBefore = sessionTraces.filter(t => t.timestamp < trace.timestamp).length;
      const costBefore = sessionTraces
        .filter(t => t.timestamp < trace.timestamp)
        .reduce((sum, t) => sum + t.cost, 0);

      this.failurePatterns.set(signature, {
        patternId: `fail-${signature.substring(0, 8)}`,
        signature,
        operation: trace.operation,
        failureType: trace.failureType || 'unknown',
        occurrenceCount: 1,
        lastSeen: Date.now(),
        avgCostBeforeFailure: costBefore,
        avgStepsBeforeFailure: stepsBefore,
      });
    }
  }

  private hashLoop(nodeHashes: string[]): string {
    return createHash('sha256')
      .update(nodeHashes.join(':'))
      .digest('hex')
      .substring(0, 32);
  }

  private hashSequence(operations: string[]): string {
    return createHash('sha256')
      .update(operations.join(':'))
      .digest('hex')
      .substring(0, 32);
  }

  private cleanup(): void {
    const now = Date.now();

    // Clean up old traces
    for (const [sessionId, traces] of this.traces) {
      const recent = traces.filter(t => now - t.timestamp < this.ttlMs);
      if (recent.length === 0) {
        this.traces.delete(sessionId);
      } else if (recent.length < traces.length) {
        this.traces.set(sessionId, recent);
      }
    }

    // Clean up old patterns
    this.evictOldPatterns(this.failurePatterns, now);
    this.evictOldPatterns(this.loopSignatures, now);
    this.evictOldPatterns(this.successSequences, now);
  }

  private evictOldPatterns(patterns: Map<string, { lastSeen: number }>, now: number): void {
    for (const [key, pattern] of patterns) {
      if (now - pattern.lastSeen > this.ttlMs) {
        patterns.delete(key);
      }
    }
  }

  private evictOldest<K, V extends { lastSeen: number }>(map: Map<K, V>): void {
    let oldest: { key: K; time: number } | null = null;

    for (const [key, value] of map) {
      if (!oldest || value.lastSeen < oldest.time) {
        oldest = { key, time: value.lastSeen };
      }
    }

    if (oldest) {
      map.delete(oldest.key);
    }
  }

  /**
   * Get memory stats
   */
  getStats(): {
    activeSessions: number;
    totalTraces: number;
    failurePatterns: number;
    loopSignatures: number;
    successSequences: number;
  } {
    let totalTraces = 0;
    for (const traces of this.traces.values()) {
      totalTraces += traces.length;
    }

    return {
      activeSessions: this.traces.size,
      totalTraces,
      failurePatterns: this.failurePatterns.size,
      loopSignatures: this.loopSignatures.size,
      successSequences: this.successSequences.size,
    };
  }

  /**
   * Clear session
   */
  clearSession(sessionId: string): void {
    this.traces.delete(sessionId);
  }

  /**
   * Reset all
   */
  reset(): void {
    this.traces.clear();
    this.failurePatterns.clear();
    this.loopSignatures.clear();
    this.successSequences.clear();
  }
}

export const executionMemory = new ExecutionMemory();
