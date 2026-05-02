/**
 * LoopShield
 * 
 * Detects and stops semantic loop explosions in AI agents BEFORE cost escalates.
 * 
 * ONE PURPOSE: Prevent the $3,000–$10,000 overnight runaway agent bill.
 * 
 * DETECTS: Semantic loops (same intent, different phrasing, converging actions)
 * NOT: Generic cost limits, step counting, or naive duplicate detection.
 */

import { performance } from 'perf_hooks';
import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ShieldConfig {
  loopProbabilityThreshold?: number;  // Default: 0.75
  explosionRiskThreshold?: number;    // Default: 0.85
  maxSessionCost?: number;            // Default: $50 (emergency brake only)
  failOpen?: boolean;                 // Default: true
}

export interface AgentAction {
  id: string;
  timestamp: number;
  operation: string;        // e.g., "llm.generate", "tool.search"
  toolName?: string;
  input: string;            // Raw input/prompt
  inputEmbedding?: number[];  // Simplified embedding vector
  estimatedCost: number;
  metadata?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export interface LoopDetectionResult {
  blocked: boolean;
  loopProbability: number;       // 0-1
  explosionRiskScore: number;    // 0-1
  estimatedAvoidableCost: number;  // $ saved if blocked now
  explanation: string;             // Human-readable
  detectedPatterns: string[];      // Which signals triggered
  latencyMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT 1: SEMANTIC EMBEDDING CACHE (simulated for <5ms)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simulates semantic embeddings using character n-gram frequency vectors.
 * Fast, deterministic, no external dependencies.
 */
class SemanticEmbeddingCache {
  private cache = new Map<string, number[]>();
  private maxCacheSize = 1000;

  /**
   * Generate simplified embedding (character trigram histogram)
   * Runs in <0.5ms for typical inputs
   */
  embed(text: string): number[] {
    const cached = this.cache.get(text);
    if (cached) return cached;

    // Character trigram frequency vector (simplified but effective)
    const vector = new Array(256).fill(0);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    
    for (let i = 0; i < normalized.length - 2; i++) {
      const tri = normalized.substring(i, i + 3);
      const hash = this.hashTrigram(tri);
      vector[hash]++;
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    const normalizedVector = magnitude > 0 ? vector.map(v => v / magnitude) : vector;

    // Cache if room
    if (this.cache.size < this.maxCacheSize) {
      this.cache.set(text, normalizedVector);
    }

    return normalizedVector;
  }

  private hashTrigram(tri: string): number {
    let hash = 0;
    for (let i = 0; i < tri.length; i++) {
      hash = ((hash << 5) - hash) + tri.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 256;
  }

  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT 2: SEMANTIC LOOP DETECTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

interface SessionState {
  actions: AgentAction[];
  totalCost: number;
  startTime: number;
  lastActivity: number;
}

class SemanticLoopDetectionEngine {
  private sessions = new Map<string, SessionState>();
  private embeddings = new SemanticEmbeddingCache();
  private config: Required<ShieldConfig>;

  constructor(config: ShieldConfig = {}) {
    this.config = {
      loopProbabilityThreshold: 0.75,
      explosionRiskThreshold: 0.85,
      maxSessionCost: 50,
      failOpen: true,
      ...config,
    };

    // Cleanup old sessions every minute
    setInterval(() => this.cleanup(), 60000);
  }

  detect(sessionId: string, action: AgentAction): LoopDetectionResult {
    const start = performance.now();

    try {
      // Get or create session
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = {
          actions: [],
          totalCost: 0,
          startTime: Date.now(),
          lastActivity: Date.now(),
        };
        this.sessions.set(sessionId, session);
      }

      // Generate embedding for this action
      action.inputEmbedding = this.embeddings.embed(action.input);

      // DETECTION SIGNALS
      const signals = this.analyzeSignals(session, action);

      // Calculate loop probability (weighted ensemble)
      const loopProbability = this.calculateLoopProbability(signals);

      // Calculate explosion risk (time + cost velocity)
      const explosionRisk = this.calculateExplosionRisk(session, action, signals);

      // Calculate avoidable cost
      const estimatedAvoidableCost = this.calculateAvoidableCost(session, loopProbability);

      // Build explanation
      const explanation = this.buildExplanation(signals, loopProbability, explosionRisk, estimatedAvoidableCost);

      // Decision
      const blocked = loopProbability > this.config.loopProbabilityThreshold ||
                      explosionRisk > this.config.explosionRiskThreshold ||
                      (session.totalCost + action.estimatedCost > this.config.maxSessionCost);

      // Record action if not blocked
      if (!blocked) {
        session.actions.push(action);
        session.totalCost += action.estimatedCost;
        session.lastActivity = Date.now();
      }

      return {
        blocked,
        loopProbability,
        explosionRiskScore: explosionRisk,
        estimatedAvoidableCost,
        explanation,
        detectedPatterns: signals.triggeredPatterns,
        latencyMs: performance.now() - start,
      };

    } catch (error) {
      return {
        blocked: this.config.failOpen ? false : true,
        loopProbability: 0,
        explosionRiskScore: 0,
        estimatedAvoidableCost: 0,
        explanation: `Detection error: ${error instanceof Error ? error.message : 'unknown'}`,
        detectedPatterns: [],
        latencyMs: performance.now() - start,
      };
    }
  }

  /**
   * Analyze 5 required signals:
   * 1. Embedding similarity between consecutive actions
   * 2. Intent drift score (convergence detection)
   * 3. Tool-call repetition graph
   * 4. Entropy reduction over time
   * 5. Cost velocity acceleration
   */
  private analyzeSignals(session: SessionState, currentAction: AgentAction): {
    embeddingSimilarity: number;
    intentConvergenceScore: number;
    toolRepetitionScore: number;
    entropyReduction: number;
    costVelocityAcceleration: number;
    triggeredPatterns: string[];
  } {
    const recentActions = session.actions.slice(-10); // Look at last 10
    const triggeredPatterns: string[] = [];

    // SIGNAL 1: Embedding Similarity
    let embeddingSimilarity = 0;
    if (recentActions.length > 0 && currentAction.inputEmbedding) {
      for (const prev of recentActions.slice(-3)) { // Compare with last 3
        if (prev.inputEmbedding) {
          const sim = this.embeddings.cosineSimilarity(
            currentAction.inputEmbedding,
            prev.inputEmbedding
          );
          embeddingSimilarity = Math.max(embeddingSimilarity, sim);
        }
      }
    }
    if (embeddingSimilarity > 0.85) triggeredPatterns.push('high_embedding_similarity');

    // SIGNAL 2: Intent Convergence Score
    // Check if we're converging to same solution repeatedly
    let intentConvergenceScore = 0;
    if (recentActions.length >= 3) {
      const last3 = recentActions.slice(-3);
      const similarities: number[] = [];
      for (let i = 0; i < last3.length - 1; i++) {
        if (last3[i].inputEmbedding && last3[i + 1].inputEmbedding) {
          similarities.push(
            this.embeddings.cosineSimilarity(last3[i].inputEmbedding!, last3[i + 1].inputEmbedding!)
          );
        }
      }
      // High similarity AND stable = convergence
      const avgSim = similarities.length > 0 
        ? similarities.reduce((a, b) => a + b, 0) / similarities.length 
        : 0;
      const variance = similarities.length > 1
        ? similarities.reduce((sum, s) => sum + Math.pow(s - avgSim, 2), 0) / similarities.length
        : 1;
      
      // High similarity with low variance = stuck in converging loop
      intentConvergenceScore = avgSim * (1 - Math.min(1, variance * 3));
    }
    if (intentConvergenceScore > 0.8) triggeredPatterns.push('intent_convergence');

    // SIGNAL 3: Tool Repetition Score
    let toolRepetitionScore = 0;
    const currentTool = currentAction.toolName || currentAction.operation;
    const recentTools = recentActions.map(a => a.toolName || a.operation);
    const toolCounts = new Map<string, number>();
    for (const tool of recentTools) {
      toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
    }
    const currentCount = toolCounts.get(currentTool) || 0;
    if (currentCount >= 2) {
      toolRepetitionScore = Math.min(1, currentCount / 5);
      triggeredPatterns.push('repeated_tool_calls');
    }

    // SIGNAL 4: Entropy Reduction
    // Measure if action variety is decreasing (agent getting stuck)
    let entropyReduction = 0;
    if (session.actions.length >= 5) {
      const firstHalf = session.actions.slice(0, Math.floor(session.actions.length / 2));
      const secondHalf = session.actions.slice(Math.floor(session.actions.length / 2));
      
      // Calculate "operation diversity" in each half
      const firstOps = new Set(firstHalf.map(a => a.operation)).size;
      const secondOps = new Set(secondHalf.map(a => a.operation)).size;
      
      // If second half has fewer unique operations = entropy reduction
      if (firstOps > 0) {
        entropyReduction = Math.max(0, (firstOps - secondOps) / firstOps);
      }
    }
    if (entropyReduction > 0.5) triggeredPatterns.push('entropy_reduction');

    // SIGNAL 5: Cost Velocity Acceleration
    // Detect if spending is accelerating (runaway signal)
    let costVelocityAcceleration = 0;
    if (recentActions.length >= 3) {
      const costs = recentActions.map(a => a.estimatedCost);
      const diffs: number[] = [];
      for (let i = 1; i < costs.length; i++) {
        diffs.push(costs[i] - costs[i - 1]);
      }
      // If recent diffs are increasing = acceleration
      if (diffs.length >= 2) {
        const earlyAvg = diffs.slice(0, Math.floor(diffs.length / 2)).reduce((a, b) => a + b, 0) 
          / Math.floor(diffs.length / 2);
        const lateAvg = diffs.slice(Math.floor(diffs.length / 2)).reduce((a, b) => a + b, 0) 
          / Math.ceil(diffs.length / 2);
        
        if (earlyAvg !== 0) {
          costVelocityAcceleration = Math.max(0, (lateAvg - earlyAvg) / Math.abs(earlyAvg));
        }
      }
    }
    if (costVelocityAcceleration > 1.0) triggeredPatterns.push('cost_acceleration');

    return {
      embeddingSimilarity,
      intentConvergenceScore,
      toolRepetitionScore,
      entropyReduction,
      costVelocityAcceleration,
      triggeredPatterns,
    };
  }

  private calculateLoopProbability(signals: ReturnType<typeof this.analyzeSignals>): number {
    // Weighted ensemble of signals
    const weights = {
      embedding: 0.30,
      intent: 0.25,
      tool: 0.20,
      entropy: 0.15,
      velocity: 0.10,
    };

    let score = 
      signals.embeddingSimilarity * weights.embedding +
      signals.intentConvergenceScore * weights.intent +
      signals.toolRepetitionScore * weights.tool +
      signals.entropyReduction * weights.entropy +
      Math.min(1, signals.costVelocityAcceleration) * weights.velocity;

    // Boost if multiple signals are high (ensemble effect)
    const highSignals = [
      signals.embeddingSimilarity > 0.8,
      signals.intentConvergenceScore > 0.7,
      signals.toolRepetitionScore > 0.6,
      signals.entropyReduction > 0.5,
    ].filter(Boolean).length;

    if (highSignals >= 3) score += 0.15;
    if (highSignals >= 4) score += 0.10;

    return Math.min(1, score);
  }

  private calculateExplosionRisk(
    session: SessionState, 
    action: AgentAction,
    signals: ReturnType<typeof this.analyzeSignals>
  ): number {
    // Time-based risk: longer sessions = higher risk
    const sessionDuration = Date.now() - session.startTime;
    const timeRisk = Math.min(1, sessionDuration / (60 * 60 * 1000)); // 1 hour = max risk

    // Cost velocity risk
    const recentCost = session.actions.slice(-5).reduce((sum, a) => sum + a.estimatedCost, 0);
    const costVelocity = recentCost / 5; // avg per recent action
    const costRisk = Math.min(1, costVelocity / 0.5); // $0.50 per call = high

    // Loop + high cost = explosion risk
    const loopRisk = signals.embeddingSimilarity > 0.8 && signals.intentConvergenceScore > 0.7 ? 0.8 : 0;

    return Math.min(1, (timeRisk * 0.3 + costRisk * 0.3 + loopRisk * 0.4));
  }

  private calculateAvoidableCost(session: SessionState, loopProbability: number): number {
    // If we don't stop now, what's the projected cost?
    if (loopProbability < 0.5) return 0;

    const recentCost = session.actions.slice(-3).reduce((sum, a) => sum + a.estimatedCost, 0);
    const avgCost = recentCost / 3;
    
    // Project: if loop continues for 50 more iterations
    const projectedIterations = Math.floor((1 - loopProbability) * 50) + 10;
    return avgCost * projectedIterations;
  }

  private buildExplanation(
    signals: ReturnType<typeof this.analyzeSignals>,
    loopProb: number,
    explosionRisk: number,
    avoidableCost: number
  ): string {
    const parts: string[] = [];

    if (signals.triggeredPatterns.includes('high_embedding_similarity')) {
      parts.push('Input is semantically similar to recent actions');
    }
    if (signals.triggeredPatterns.includes('intent_convergence')) {
      parts.push('Agent appears stuck converging on same solution');
    }
    if (signals.triggeredPatterns.includes('repeated_tool_calls')) {
      parts.push('Same tools being called repeatedly');
    }
    if (signals.triggeredPatterns.includes('entropy_reduction')) {
      parts.push('Action variety decreasing (getting stuck)');
    }
    if (signals.triggeredPatterns.includes('cost_acceleration')) {
      parts.push('Cost per action is accelerating');
    }

    let explanation = parts.length > 0 
      ? `Loop detected: ${parts.join('; ')}.`
      : 'No loop patterns detected.';

    explanation += ` Loop probability: ${(loopProb * 100).toFixed(0)}%.`;
    
    if (avoidableCost > 0) {
      explanation += ` Blocking saves ~$${avoidableCost.toFixed(2)} in projected costs.`;
    }

    if (explosionRisk > 0.7) {
      explanation += ` Explosion risk: ${(explosionRisk * 100).toFixed(0)}%.`;
    }

    return explanation;
  }

  private cleanup(): void {
    const now = Date.now();
    const ttl = 2 * 60 * 60 * 1000; // 2 hours

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > ttl) {
        this.sessions.delete(id);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT 3: SDK WRAPPER (one-line integration)
// ═══════════════════════════════════════════════════════════════════════════════

let globalEngine: SemanticLoopDetectionEngine | null = null;

export function initLoopShield(config?: ShieldConfig): void {
  globalEngine = new SemanticLoopDetectionEngine(config);
}

/**
 * ONE-LINE INTEGRATION:
 * 
 * const client = shield(new OpenAI({ apiKey }));
 */
export function shield<T extends object>(client: T, sessionId?: string): T {
  if (!globalEngine) {
    globalEngine = new SemanticLoopDetectionEngine();
  }

  const sid = sessionId || `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  return new Proxy(client, {
    get(target, prop: string | symbol) {
      if (typeof prop !== 'string') return (target as any)[prop];
      
      const value = (target as any)[prop];

      // Intercept method calls
      if (typeof value === 'function') {
        return async (...args: any[]) => {
          // Extract operation info
          const operation = prop;
          const input = JSON.stringify(args);
          const estimatedCost = estimateCost(operation, args);

          // DETECT LOOP
          const result = globalEngine!.detect(sid, {
            id: `${sid}-${Date.now()}`,
            timestamp: Date.now(),
            operation,
            toolName: extractToolName(operation, args),
            input,
            estimatedCost,
            metadata: extractMetadata(args),
          });

          if (result.blocked) {
            const error = new Error(`LoopShield blocked: ${result.explanation}`);
            (error as any).shieldResult = result;
            throw error;
          }

          // Execute
          return value.apply(target, args);
        };
      }

      // Handle nested objects
      if (typeof value === 'object' && value !== null) {
        return shield(value as T, sid);
      }

      return value;
    },
  });
}

function estimateCost(operation: string, args: any[]): number {
  // Estimate based on max_tokens
  let tokens = 1000;
  if (args[0]?.max_tokens) tokens = args[0].max_tokens;
  else if (args[0]?.maxTokens) tokens = args[0].maxTokens;
  
  // GPT-4 rate: $0.03 per 1K tokens
  return (tokens / 1000) * 0.03;
}

function extractToolName(operation: string, args: any[]): string | undefined {
  if (args[0]?.model) return args[0].model;
  if (args[0]?.tool) return args[0].tool;
  return operation;
}

function extractMetadata(args: any[]): { model?: string; temperature?: number; maxTokens?: number } {
  if (!args[0]) return {};
  return {
    model: args[0].model || args[0].modelName,
    temperature: args[0].temperature,
    maxTokens: args[0].max_tokens || args[0].maxTokens,
  };
}

// Manual check for non-SDK usage
export function checkLoop(
  sessionId: string,
  operation: string,
  input: string,
  estimatedCost: number,
  toolName?: string
): LoopDetectionResult {
  if (!globalEngine) {
    globalEngine = new SemanticLoopDetectionEngine();
  }

  return globalEngine.detect(sessionId, {
    id: `${sessionId}-${Date.now()}`,
    timestamp: Date.now(),
    operation,
    toolName,
    input,
    estimatedCost,
  });
}
