/**
 * CostGuard - AI Agent Cost Prevention SDK
 * 
 * ONE PURPOSE: Prevent cost explosions BEFORE they happen.
 * THREE RULES: Loop detection, cost limits, deduplication.
 * ONE LINE: Wraps your SDK client.
 * 
 * NO ML. NO PROXY. NO INFRA. NO PLATFORM.
 * Just in-process deterministic cost prevention.
 */

import { performance } from 'perf_hooks';
import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface GuardConfig {
  maxCostPerSession?: number;   // Default: $10
  maxStepsPerSession?: number;    // Default: 50
  maxDuplicateCalls?: number;   // Default: 3
  failOpen?: boolean;             // Default: true
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  blockedCost?: number;
  latencyMs: number;
}

export interface CallContext {
  sessionId: string;
  step: number;
  operation: string;
  estimatedCost: number;
  inputHash: string;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT 1: SESSION STORE (tracks session state)
// ═══════════════════════════════════════════════════════════════

interface SessionState {
  totalCost: number;
  steps: number;
  callHashes: string[];
  lastActivity: number;
}

class SessionStore {
  private sessions = new Map<string, SessionState>();
  private maxSessions = 10000;
  private ttlMs = 60 * 60 * 1000; // 1 hour

  constructor() {
    setInterval(() => this.cleanup(), 60000);
  }

  get(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    
    if (!session) {
      if (this.sessions.size >= this.maxSessions) {
        this.evictOldest();
      }
      session = { totalCost: 0, steps: 0, callHashes: [], lastActivity: Date.now() };
      this.sessions.set(sessionId, session);
    }

    session.lastActivity = Date.now();
    return session;
  }

  recordCall(sessionId: string, inputHash: string, cost: number): void {
    const session = this.get(sessionId);
    session.steps++;
    session.totalCost += cost;
    session.callHashes.push(inputHash);
    
    // Keep only last 20 hashes for dedup
    if (session.callHashes.length > 20) {
      session.callHashes.shift();
    }
  }

  countDuplicates(sessionId: string, inputHash: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;
    return session.callHashes.filter(h => h === inputHash).length;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
  }

  private evictOldest(): void {
    let oldest: { id: string; time: number } | null = null;
    for (const [id, session] of this.sessions) {
      if (!oldest || session.lastActivity < oldest.time) {
        oldest = { id, time: session.lastActivity };
      }
    }
    if (oldest) this.sessions.delete(oldest.id);
  }
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT 2: RULE ENGINE (deterministic - 3 rules only)
// ═══════════════════════════════════════════════════════════════

type RuleResult = { triggered: true; reason: string; blockedCost: number } | { triggered: false };

class RuleEngine {
  private config: Required<GuardConfig>;

  constructor(config: GuardConfig) {
    this.config = {
      maxCostPerSession: 10,
      maxStepsPerSession: 50,
      maxDuplicateCalls: 3,
      failOpen: true,
      ...config,
    };
  }

  // RULE 1: Cost Limit
  checkCost(session: SessionState, estimatedCost: number): RuleResult {
    const projected = session.totalCost + estimatedCost;
    if (projected > this.config.maxCostPerSession) {
      return {
        triggered: true,
        reason: `Cost limit: $${projected.toFixed(2)} > $${this.config.maxCostPerSession}`,
        blockedCost: estimatedCost,
      };
    }
    return { triggered: false };
  }

  // RULE 2: Loop Detection (step limit)
  checkLoop(session: SessionState): RuleResult {
    if (session.steps >= this.config.maxStepsPerSession) {
      return {
        triggered: true,
        reason: `Step limit: ${session.steps} >= ${this.config.maxStepsPerSession}`,
        blockedCost: 0,
      };
    }
    return { triggered: false };
  }

  // RULE 3: Deduplication
  checkDuplicate(duplicateCount: number, estimatedCost: number): RuleResult {
    if (duplicateCount >= this.config.maxDuplicateCalls) {
      return {
        triggered: true,
        reason: `Duplicate limit: ${duplicateCount} >= ${this.config.maxDuplicateCalls}`,
        blockedCost: estimatedCost,
      };
    }
    return { triggered: false };
  }

  getConfig(): Required<GuardConfig> {
    return this.config;
  }
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT 3: GUARD CORE (<5ms execution)
// ═══════════════════════════════════════════════════════════════

class GuardCore {
  private store: SessionStore;
  private rules: RuleEngine;

  constructor(config: GuardConfig = {}) {
    this.store = new SessionStore();
    this.rules = new RuleEngine(config);
  }

  check(context: CallContext): GuardResult {
    const start = performance.now();

    try {
      const session = this.store.get(context.sessionId);

      // Check Rule 1: Cost
      const costCheck = this.rules.checkCost(session, context.estimatedCost);
      if (costCheck.triggered) {
        return {
          allowed: false,
          reason: costCheck.reason,
          blockedCost: costCheck.blockedCost,
          latencyMs: performance.now() - start,
        };
      }

      // Check Rule 2: Loop
      const loopCheck = this.rules.checkLoop(session);
      if (loopCheck.triggered) {
        return {
          allowed: false,
          reason: loopCheck.reason,
          blockedCost: loopCheck.blockedCost,
          latencyMs: performance.now() - start,
        };
      }

      // Check Rule 3: Duplicate
      const dupCount = this.store.countDuplicates(context.sessionId, context.inputHash);
      const dupCheck = this.rules.checkDuplicate(dupCount, context.estimatedCost);
      if (dupCheck.triggered) {
        return {
          allowed: false,
          reason: dupCheck.reason,
          blockedCost: dupCheck.blockedCost,
          latencyMs: performance.now() - start,
        };
      }

      // All checks passed - record the call
      this.store.recordCall(context.sessionId, context.inputHash, context.estimatedCost);

      return {
        allowed: true,
        latencyMs: performance.now() - start,
      };

    } catch (error) {
      // Fail open on error
      return {
        allowed: this.rules.getConfig().failOpen,
        reason: `Guard error: ${error instanceof Error ? error.message : 'unknown'}`,
        latencyMs: performance.now() - start,
      };
    }
  }

  getSessionCost(sessionId: string): number {
    return this.store.get(sessionId).totalCost;
  }
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT 4: SDK WRAPPER (one-line integration)
// ═══════════════════════════════════════════════════════════════

// Global guard instance
let globalGuard: GuardCore | null = null;

export function initGuard(config?: GuardConfig): void {
  globalGuard = new GuardCore(config);
}

/**
 * Wrap an OpenAI/Anthropic client with cost protection.
 * 
 * ONE LINE INTEGRATION:
 * ```typescript
 * const client = guard(new OpenAI({ apiKey }));
 * ```
 */
export function guard<T extends object>(client: T, sessionId?: string): T {
  if (!globalGuard) {
    globalGuard = new GuardCore();
  }

  const sid = sessionId || `session-${Date.now()}`;
  let step = 0;

  return new Proxy(client, {
    get(target, prop: string | symbol) {
      if (typeof prop !== 'string') return target[prop as keyof T];
      const value = target[prop as keyof T];

      // Intercept method calls
      if (typeof value === 'function') {
        return async (...args: any[]) => {
          step++;

          // Estimate cost from arguments
          const estimatedCost = estimateCost(prop as string, args);
          const inputHash = hashArgs(args);

          // Check guard
          const result = globalGuard!.check({
            sessionId: sid,
            step,
            operation: prop as string,
            estimatedCost,
            inputHash,
          });

          if (!result.allowed) {
            const error = new Error(`CostGuard blocked: ${result.reason}`);
            (error as any).guardResult = result;
            throw error;
          }

          // Execute
          return value.apply(target, args);
        };
      }

      // Handle nested objects (like client.chat.completions)
      if (typeof value === 'object' && value !== null) {
        return guard(value as T, sid);
      }

      return value;
    },
  });
}

// Helper: Estimate cost from operation + args
function estimateCost(operation: string, args: any[]): number {
  // Simple heuristic: $0.03 per 1K tokens for completion
  if (operation.includes('create') || operation.includes('generate')) {
    const tokens = args[0]?.max_tokens || 1000;
    return (tokens / 1000) * 0.03;
  }
  return 0.01; // Default for other operations
}

// Helper: Hash arguments for dedup
function hashArgs(args: any[]): string {
  const str = JSON.stringify(args);
  return createHash('sha256').update(str).digest('hex').substring(0, 16);
}

// Helper: Manual guard check (non-SDK usage)
export function check(
  sessionId: string,
  operation: string,
  estimatedCost: number,
  input: string
): GuardResult {
  if (!globalGuard) {
    globalGuard = new GuardCore();
  }

  const inputHash = createHash('sha256').update(input).digest('hex').substring(0, 16);
  
  // Estimate step from session
  const session = (globalGuard as any).store.get(sessionId);
  const step = session.steps + 1;

  return globalGuard.check({
    sessionId,
    step,
    operation,
    estimatedCost,
    inputHash,
  });
}

// Types already exported at top of file
