/**
 * DetectionEngine.ts - SINGLE Core Detection Engine
 * 
 * This is the ONLY place where detection happens in AI Execution Firewall.
 * All detection logic lives here. CLI, SDK, Proxy just call this engine.
 * 
 * Architecture:
 *   Input (CLI/SDK/Proxy) → DetectionEngine.analyze() → Result
 * 
 * Detection Priority:
 *   1. Loop detection (3+ identical in 30s)
 *   2. Duplicate detection (1+ identical in 1h)
 *   3. Cost spike ($0.05+)
 *   4. Context explosion (5x+ ratio)
 *   5. Fuzzy duplicate (70%+ similarity)
 */

import { randomUUID } from 'crypto';
import { stateStore, RequestRecord } from './StateStore';
import { DETECTION_THRESHOLDS, TIME_WINDOWS, DECISIONS, ALERT_CATEGORIES } from '../config/constants';
import { ConfigManager } from '../config';
import { performance } from 'perf_hooks';

export type Decision = 'allow' | 'warn' | 'block';
export type Category = 'loop' | 'duplicate' | 'fuzzy_duplicate' | 'context' | 'spike' | 'safe' | 'invalid';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DetectionResult {
  decision: Decision;
  dangerScore: number; // 0-100
  riskLevel: RiskLevel; // LOW/MEDIUM/HIGH/CRITICAL
  category: Category;
  reason: string;
  saved: number; // Money saved by this decision
  wouldHaveLost: number; // What would have been lost without firewall
  metadata: {
    promptHash: string;
    duplicateCount: number;
    loopCount: number;
    estimatedCost: number;
    similarity?: number;
    contextRatio?: number;
    timingsMs?: {
      total: number;
      loop: number;
      duplicate: number;
      cost: number;
      budget: number;
      context: number;
      fuzzy: number;
    };
  };
}

/**
 * Map danger score (0-100) to risk level
 * 0-30: LOW, 31-70: MEDIUM, 71-100: HIGH, 90+: CRITICAL (kill switch)
 */
function getRiskLevel(dangerScore: number): RiskLevel {
  if (dangerScore >= 90) return 'CRITICAL';
  if (dangerScore >= 71) return 'HIGH';
  if (dangerScore >= 31) return 'MEDIUM';
  return 'LOW';
}

export interface AnalyzeInput {
  model: string;
  prompt: string;
  estimatedCost: number;
  context?: string;
  trustMode?: 'monitor' | 'warn' | 'block';
  override?: boolean;
  onBlock?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onWarn?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onSpike?: (requests: number, timeWindow: number) => void;
}

export interface AlertHooks {
  onBlock?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onWarn?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onSpike?: (requests: number, timeWindow: number) => void;
}

/**
 * DetectionEngine - Singleton
 * The single brain of AI Execution Firewall
 */
export class DetectionEngine {
  private static instance: DetectionEngine;
  private timingStats = {
    totalCalls: 0,
    cumulativeMs: 0,
  };
  private readonly KILL_SWITCH_THRESHOLD = DETECTION_THRESHOLDS.KILL_SWITCH;
  private readonly LOOP_THRESHOLD = DETECTION_THRESHOLDS.LOOP_COUNT;
  private readonly LOOP_WINDOW = TIME_WINDOWS.LOOP;
  private readonly DUPLICATE_WINDOW = TIME_WINDOWS.DUPLICATE;
  private readonly COST_THRESHOLD = DETECTION_THRESHOLDS.COST_SPIKE_DOLLARS;
  private readonly CONTEXT_RATIO_THRESHOLD = DETECTION_THRESHOLDS.CONTEXT_RATIO;
  private readonly FUZZY_THRESHOLD = DETECTION_THRESHOLDS.FUZZY_SIMILARITY;

  private constructor() {}

  static getInstance(): DetectionEngine {
    if (!DetectionEngine.instance) {
      DetectionEngine.instance = new DetectionEngine();
    }
    return DetectionEngine.instance;
  }

  /**
   * Main entry point - analyze a request
   * This is the ONLY detection method. All interfaces call this.
   */
  analyze(input: AnalyzeInput): DetectionResult {
    const totalStart = performance.now();
    const timing = {
      loop: 0,
      duplicate: 0,
      cost: 0,
      budget: 0,
      context: 0,
      fuzzy: 0,
    };
    const { model, prompt, estimatedCost, context, trustMode = 'warn', override = false } = input;

    // Input validation
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return this.withTiming(this.createResult('block', 100, 'invalid', 'Invalid prompt: must be a non-empty string', {
        promptHash: '',
        duplicateCount: 0,
        loopCount: 0,
        estimatedCost: 0
      }), totalStart, timing);
    }

    if (typeof estimatedCost !== 'number' || estimatedCost < 0) {
      return this.withTiming(this.createResult('block', 100, 'invalid', 'Invalid cost: must be a non-negative number', {
        promptHash: '',
        duplicateCount: 0,
        loopCount: 0,
        estimatedCost: 0
      }), totalStart, timing);
    }

    // Override - allow anything
    if (override) {
      const hash = stateStore.generateHash(prompt, context);
      this.recordRequest(input, hash, false, 0, 'safe', 'Override enabled');
      return this.withTiming(this.createResult('allow', 0, 'safe', 'Override enabled - request allowed', {
        promptHash: hash,
        duplicateCount: 0,
        loopCount: 0,
        estimatedCost
      }), totalStart, timing);
    }

    // Generate hash
    const promptHash = stateStore.generateHash(prompt, context);

    // Check 1: Runaway loop (CRITICAL - highest priority)
    const loopStart = performance.now();
    const loopCheck = this.detectLoop(promptHash);
    timing.loop = performance.now() - loopStart;
    if (loopCheck.isLoop) {
      // Score: 90 base + 3 per request beyond threshold, capped at 100
      // r3: 90 + 3*(3-2) = 93, r4: 90 + 3*(4-2) = 96, etc.
      const dangerScore = Math.min(100, 90 + (loopCheck.count - 2) * 3);
      this.recordRequest(input, promptHash, true, dangerScore, 'loop', loopCheck.reason);
      return this.withTiming(this.createResult(
        'block',
        dangerScore,
        'loop',
        loopCheck.reason,
        { promptHash, duplicateCount: 0, loopCount: loopCheck.count, estimatedCost }
      ), totalStart, timing);
    }

    // Check 2: Exact duplicate
    const duplicateStart = performance.now();
    const duplicateCheck = this.detectDuplicate(promptHash);
    timing.duplicate = performance.now() - duplicateStart;
    if (duplicateCheck.isDuplicate) {
      // Score: 30 base + 10 per duplicate, capped at 90
      // First duplicate = 40 (warn), Second = 50 (block threshold)
      const dangerScore = Math.min(90, 30 + duplicateCheck.count * 10);
      const decision = this.determineDecision(dangerScore, trustMode);
      
      // Trigger hooks if provided
      if (decision === 'block' && input.onBlock) {
        input.onBlock(duplicateCheck.reason, dangerScore, estimatedCost);
      } else if (decision === 'warn' && input.onWarn) {
        input.onWarn(duplicateCheck.reason, dangerScore, estimatedCost);
      }
      
      this.recordRequest(input, promptHash, true, dangerScore, 'duplicate', duplicateCheck.reason);
      return this.withTiming(this.createResult(
        decision,
        dangerScore,
        'duplicate',
        duplicateCheck.reason,
        { promptHash, duplicateCount: duplicateCheck.count, loopCount: loopCheck.count, estimatedCost }
      ), totalStart, timing);
    }

    // Check 3: Cost spike
    const costStart = performance.now();
    const costCheck = this.detectCostSpike(estimatedCost);
    timing.cost = performance.now() - costStart;
    if (costCheck.isSpike) {
      const dangerScore = costCheck.score;
      const decision = this.determineDecision(dangerScore, trustMode);
      
      // Trigger onSpike hook if provided
      if (input.onSpike) {
        input.onSpike(1, 60); // 1 spike detected in 60s window
      }
      
      this.recordRequest(input, promptHash, true, dangerScore, 'spike', costCheck.reason);
      return this.withTiming(this.createResult(
        decision,
        dangerScore,
        'spike',
        costCheck.reason,
        { promptHash, duplicateCount: 0, loopCount: loopCheck.count, estimatedCost }
      ), totalStart, timing);
    }

    // Check 3.5: Daily budget protection
    const budgetStart = performance.now();
    const budgetCheck = this.detectBudgetLimit(estimatedCost);
    timing.budget = performance.now() - budgetStart;
    if (budgetCheck.wouldExceed) {
      const dangerScore = 75; // High score for budget protection
      const reason = `💰 DAILY BUDGET EXCEEDED: Would exceed $${budgetCheck.budget.toFixed(2)} daily limit`;
      
      // Trigger onBlock hook if provided
      if (input.onBlock) {
        input.onBlock(reason, dangerScore, estimatedCost);
      }
      
      this.recordRequest(input, promptHash, true, dangerScore, 'spike', reason);
      return this.withTiming(this.createResult(
        'block',
        dangerScore,
        'spike',
        reason,
        { promptHash, duplicateCount: 0, loopCount: loopCheck.count, estimatedCost }
      ), totalStart, timing);
    }

    // Check 4: Context explosion
    if (context) {
      const contextStart = performance.now();
      const contextCheck = this.detectContextExplosion(prompt, context);
      timing.context = performance.now() - contextStart;
      if (contextCheck.isExplosion) {
        const dangerScore = contextCheck.score;
        const decision = this.determineDecision(dangerScore, trustMode);
        this.recordRequest(input, promptHash, true, dangerScore, 'context', contextCheck.reason);
        return this.withTiming(this.createResult(
          decision,
          dangerScore,
          'context',
          contextCheck.reason,
          { 
            promptHash, 
            duplicateCount: 0, 
            loopCount: loopCheck.count, 
            estimatedCost,
            contextRatio: contextCheck.ratio 
          }
        ), totalStart, timing);
      }
    }

    // Check 5: Fuzzy duplicate
    const fuzzyStart = performance.now();
    const fuzzyCheck = this.detectFuzzyDuplicate(prompt);
    timing.fuzzy = performance.now() - fuzzyStart;
    if (fuzzyCheck.isFuzzy) {
      const dangerScore = Math.min(70, 30 + fuzzyCheck.similarity * 40);
      const decision = this.determineDecision(dangerScore, trustMode);
      this.recordRequest(input, promptHash, true, dangerScore, 'fuzzy_duplicate', fuzzyCheck.reason);
      return this.withTiming(this.createResult(
        decision,
        dangerScore,
        'fuzzy_duplicate',
        fuzzyCheck.reason,
        { 
          promptHash, 
          duplicateCount: 0, 
          loopCount: loopCheck.count, 
          estimatedCost,
          similarity: fuzzyCheck.similarity 
        }
      ), totalStart, timing);
    }

    // Safe request
    this.recordRequest(input, promptHash, false, 0, 'safe', 'Request is safe');
    return this.withTiming(this.createResult(
      'allow',
      0,
      'safe',
      'Request is safe',
      { promptHash, duplicateCount: 0, loopCount: loopCheck.count, estimatedCost }
    ), totalStart, timing);
  }

  /**
   * Detect runaway loops (3+ identical requests in 30 seconds)
   */
  private detectLoop(promptHash: string): { isLoop: boolean; count: number; reason: string } {
    const recent = stateStore.getRecentByHash(promptHash, this.LOOP_WINDOW);
    // KILL SWITCH: Trigger when total requests (existing + current) >= threshold
    // Need 3 identical requests in 30 seconds to trigger
    const totalCount = recent.length + 1; // +1 for current request
    if (totalCount >= this.LOOP_THRESHOLD) {
      return {
        isLoop: true,
        count: totalCount,
        reason: `🔴 KILL SWITCH: RUNAWAY LOOP - ${totalCount} identical requests in 30 seconds`
      };
    }
    
    return { isLoop: false, count: recent.length, reason: '' };
  }

  /**
   * Detect exact duplicates (1+ identical requests in 1 hour)
   * Any existing request with same promptHash → duplicate
   */
  private detectDuplicate(promptHash: string): { isDuplicate: boolean; count: number; reason: string } {
    const recent = stateStore.getRecentByHash(promptHash, this.DUPLICATE_WINDOW);
    
    // If ANY history item has same promptHash → duplicate
    if (recent.length > 0) {
      return {
        isDuplicate: true,
        count: recent.length,
        reason: `💸 DUPLICATE: This exact prompt was sent ${recent.length} time(s) in the last hour`
      };
    }
    
    return { isDuplicate: false, count: recent.length, reason: '' };
  }

  /**
   * Detect cost spikes ($0.05+)
   */
  private detectCostSpike(estimatedCost: number): { isSpike: boolean; score: number; reason: string } {
    if (estimatedCost >= this.COST_THRESHOLD) {
      const baseScore = 30;
      const costMultiplier = (estimatedCost - 0.05) * 50;
      // Floor to integer for deterministic output
      const score = Math.min(100, Math.floor(baseScore + costMultiplier));

      return {
        isSpike: true,
        score,
        reason: `💸 COST SPIKE: Single request costs $${estimatedCost.toFixed(2)}`
      };
    }

    return { isSpike: false, score: 0, reason: '' };
  }

  /**
   * Detect if request would exceed daily budget limit
   */
  private detectBudgetLimit(estimatedCost: number): { wouldExceed: boolean; budget: number; currentSpend: number } {
    const config = new ConfigManager();
    const dailyBudget = config.dailyBudget;

    // Get current daily spending from stats
    const stats = stateStore.getStats(24);
    const currentSpend = stats.totalCost;
    const wouldExceed = (currentSpend + estimatedCost) > dailyBudget;

    return { wouldExceed, budget: dailyBudget, currentSpend };
  }

  /**
   * Detect context explosion (context 5x+ larger than prompt)
   */
  private detectContextExplosion(
    prompt: string, 
    context: string
  ): { isExplosion: boolean; score: number; reason: string; ratio: number } {
    const promptLength = prompt.length;
    const contextLength = context.length;
    const ratio = contextLength / (promptLength || 1);
    
    // Strict threshold: 5x ratio required for detection
    if (ratio >= this.CONTEXT_RATIO_THRESHOLD) {
      // Floor ratio to 2 decimals for deterministic output
      const roundedRatio = Math.floor(ratio * 100) / 100;
      const score = Math.min(75, Math.floor(25 + Math.log(ratio) * 15));
      
      return {
        isExplosion: true,
        score,
        reason: `💸 CONTEXT EXPLOSION: Context is ${roundedRatio.toFixed(2)}x larger than prompt`,
        ratio: roundedRatio
      };
    }
    
    return { isExplosion: false, score: 0, reason: '', ratio };
  }

  /**
   * Detect fuzzy duplicates (70%+ similarity to recent requests)
   */
  private detectFuzzyDuplicate(prompt: string): { 
    isFuzzy: boolean; 
    similarity: number; 
    reason: string 
  } {
    const recentRecords = stateStore.getAllRecent(this.DUPLICATE_WINDOW);
    
    for (const record of recentRecords) {
      // Skip exact matches (already handled by duplicate detection)
      if (record.prompt === prompt) continue;
      
      const similarity = stateStore.calculateSimilarity(prompt, record.prompt);
      
      if (similarity >= this.FUZZY_THRESHOLD) {
        return {
          isFuzzy: true,
          similarity,
          reason: `⚠️ SIMILAR PROMPT: ${(similarity * 100).toFixed(0)}% similar to a recent request`
        };
      }
    }
    
    return { isFuzzy: false, similarity: 0, reason: '' };
  }

  /**
   * Determine decision based on danger score and trust mode
   */
  private determineDecision(dangerScore: number, trustMode: string): Decision {
    if (dangerScore >= this.KILL_SWITCH_THRESHOLD) return 'block';
    if (trustMode === 'monitor') return 'allow';
    if (trustMode === 'warn') return 'warn';
    if (trustMode === 'block') return 'block';
    return 'allow';
  }

  /**
   * Create result object
   */
  private createResult(
    decision: Decision,
    dangerScore: number,
    category: Category,
    reason: string,
    metadata: DetectionResult['metadata']
  ): DetectionResult {
    // Normalize dangerScore to integer (0-100) using floor
    const normalizedScore = Math.max(0, Math.min(100, Math.floor(dangerScore)));
    const riskLevel = getRiskLevel(normalizedScore);
    
    // Calculate financial impact (saved / wouldHaveLost)
    const saved = decision === 'block' ? metadata.estimatedCost : 0;
    
    // Get historical wouldHaveLost from stats and add this request
    const stats = stateStore.getStats(24);
    const historicalBlockedCost = stats.blockedRequests > 0 
      ? stats.totalCost / (stats.totalRequests || 1) * stats.blockedRequests 
      : 0;
    const wouldHaveLost = stats.totalCost + historicalBlockedCost + saved;
    
    return {
      decision,
      dangerScore: normalizedScore,
      riskLevel,
      category,
      reason,
      saved: Math.round(saved * 10000) / 10000,
      wouldHaveLost: Math.round(wouldHaveLost * 10000) / 10000,
      metadata
    };
  }

  /**
   * Record request to state store
   */
  private recordRequest(
    input: AnalyzeInput,
    promptHash: string,
    isDangerous: boolean,
    dangerScore: number,
    category: Category,
    reason: string
  ): void {
    const record: RequestRecord = {
      id: randomUUID(),
      timestamp: Date.now(),
      model: input.model,
      prompt: input.prompt,
      promptHash,
      estimatedCost: input.estimatedCost,
      dangerScore,
      isDangerous,
      category,
      wasBlocked: isDangerous && dangerScore >= 50,
      wasWarned: isDangerous,
      reason,
      context: input.context
    };
    
    stateStore.addRecord(record);
  }

  /**
   * Get statistics (for report command)
   */
  getStats(hours: number = 24) {
    return stateStore.getStats(hours);
  }

  getOperationalMetrics(hours: number = 24): {
    total_cost_saved: number;
    blocked_requests_count: number;
    false_positive_indicator: number;
    avg_analysis_latency_ms: number;
    storage_backend: 'file' | 'redis';
  } {
    const storeMetrics = stateStore.getOperationalMetrics(hours);
    const engineAvg = this.timingStats.totalCalls > 0
      ? this.timingStats.cumulativeMs / this.timingStats.totalCalls
      : 0;
    return {
      ...storeMetrics,
      avg_analysis_latency_ms: Number(engineAvg.toFixed(4)),
    };
  }

  /**
   * Get blocked requests (for blocked command)
   */
  getBlocked(limit: number = 10) {
    return stateStore.getBlocked(limit);
  }

  /**
   * Clear all state (for testing)
   */
  clear(): void {
    stateStore.clear();
  }

  /**
   * Reset state (for testing) - fully restore initial state
   */
  reset(): void {
    stateStore.reset(); // Clear cache, disk, and reinitialize
  }

  private withTiming(
    result: DetectionResult,
    totalStart: number,
    timing: {
      loop: number;
      duplicate: number;
      cost: number;
      budget: number;
      context: number;
      fuzzy: number;
    }
  ): DetectionResult {
    const total = performance.now() - totalStart;
    this.timingStats.totalCalls += 1;
    this.timingStats.cumulativeMs += total;
    if (process.env.AIFW_TIMING_LOG === 'true') {
      // Lightweight micro-timing for production debugging without changing default output.
      console.log(
        `[aifw-timing] total=${total.toFixed(4)}ms loop=${timing.loop.toFixed(4)} duplicate=${timing.duplicate.toFixed(4)} cost=${timing.cost.toFixed(4)} budget=${timing.budget.toFixed(4)} context=${timing.context.toFixed(4)} fuzzy=${timing.fuzzy.toFixed(4)}`
      );
    }
    return {
      ...result,
      metadata: {
        ...result.metadata,
        timingsMs: {
          total: Number(total.toFixed(4)),
          loop: Number(timing.loop.toFixed(4)),
          duplicate: Number(timing.duplicate.toFixed(4)),
          cost: Number(timing.cost.toFixed(4)),
          budget: Number(timing.budget.toFixed(4)),
          context: Number(timing.context.toFixed(4)),
          fuzzy: Number(timing.fuzzy.toFixed(4)),
        },
      },
    };
  }
}

// Export singleton instance
export const detectionEngine = DetectionEngine.getInstance();
