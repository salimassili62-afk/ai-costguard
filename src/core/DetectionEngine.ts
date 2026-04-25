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

export type Decision = 'allow' | 'warn' | 'block';
export type Category = 'loop' | 'duplicate' | 'fuzzy_duplicate' | 'context' | 'spike' | 'safe' | 'invalid';

export interface DetectionResult {
  decision: Decision;
  dangerScore: number; // 0-100
  category: Category;
  reason: string;
  metadata: {
    promptHash: string;
    duplicateCount: number;
    loopCount: number;
    estimatedCost: number;
    similarity?: number;
    contextRatio?: number;
  };
}

export interface AnalyzeInput {
  model: string;
  prompt: string;
  estimatedCost: number;
  context?: string;
  trustMode?: 'monitor' | 'warn' | 'block';
  override?: boolean;
}

/**
 * DetectionEngine - Singleton
 * The single brain of AI Execution Firewall
 */
export class DetectionEngine {
  private static instance: DetectionEngine;
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
    const { model, prompt, estimatedCost, context, trustMode = 'warn', override = false } = input;

    // Input validation
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return this.createResult('block', 100, 'invalid', 'Invalid prompt: must be a non-empty string', {
        promptHash: '',
        duplicateCount: 0,
        loopCount: 0,
        estimatedCost: 0
      });
    }

    if (typeof estimatedCost !== 'number' || estimatedCost < 0) {
      return this.createResult('block', 100, 'invalid', 'Invalid cost: must be a non-negative number', {
        promptHash: '',
        duplicateCount: 0,
        loopCount: 0,
        estimatedCost: 0
      });
    }

    // Override - allow anything
    if (override) {
      const hash = stateStore.generateHash(prompt, context);
      this.recordRequest(input, hash, false, 0, 'safe', 'Override enabled');
      return this.createResult('allow', 0, 'safe', 'Override enabled - request allowed', {
        promptHash: hash,
        duplicateCount: 0,
        loopCount: 0,
        estimatedCost
      });
    }

    // Generate hash
    const promptHash = stateStore.generateHash(prompt, context);

    // Check 1: Runaway loop (CRITICAL - highest priority)
    const loopCheck = this.detectLoop(promptHash);
    if (loopCheck.isLoop) {
      const dangerScore = Math.min(100, 90 + loopCheck.count * 3);
      this.recordRequest(input, promptHash, true, dangerScore, 'loop', loopCheck.reason);
      return this.createResult(
        'block',
        dangerScore,
        'loop',
        loopCheck.reason,
        { promptHash, duplicateCount: 0, loopCount: loopCheck.count, estimatedCost }
      );
    }

    // Check 2: Exact duplicate
    const duplicateCheck = this.detectDuplicate(promptHash);
    if (duplicateCheck.isDuplicate) {
      const dangerScore = Math.min(90, 40 + duplicateCheck.count * 10);
      const decision = this.determineDecision(dangerScore, trustMode);
      this.recordRequest(input, promptHash, true, dangerScore, 'duplicate', duplicateCheck.reason);
      return this.createResult(
        decision,
        dangerScore,
        'duplicate',
        duplicateCheck.reason,
        { promptHash, duplicateCount: duplicateCheck.count, loopCount: 0, estimatedCost }
      );
    }

    // Check 3: Cost spike
    const costCheck = this.detectCostSpike(estimatedCost);
    if (costCheck.isSpike) {
      const dangerScore = costCheck.score;
      const decision = this.determineDecision(dangerScore, trustMode);
      this.recordRequest(input, promptHash, true, dangerScore, 'spike', costCheck.reason);
      return this.createResult(
        decision,
        dangerScore,
        'spike',
        costCheck.reason,
        { promptHash, duplicateCount: 0, loopCount: 0, estimatedCost }
      );
    }

    // Check 4: Context explosion
    if (context) {
      const contextCheck = this.detectContextExplosion(prompt, context);
      if (contextCheck.isExplosion) {
        const dangerScore = contextCheck.score;
        const decision = this.determineDecision(dangerScore, trustMode);
        this.recordRequest(input, promptHash, true, dangerScore, 'context', contextCheck.reason);
        return this.createResult(
          decision,
          dangerScore,
          'context',
          contextCheck.reason,
          { 
            promptHash, 
            duplicateCount: 0, 
            loopCount: 0, 
            estimatedCost,
            contextRatio: contextCheck.ratio 
          }
        );
      }
    }

    // Check 5: Fuzzy duplicate
    const fuzzyCheck = this.detectFuzzyDuplicate(prompt);
    if (fuzzyCheck.isFuzzy) {
      const dangerScore = Math.min(70, 30 + fuzzyCheck.similarity * 40);
      const decision = this.determineDecision(dangerScore, trustMode);
      this.recordRequest(input, promptHash, true, dangerScore, 'fuzzy_duplicate', fuzzyCheck.reason);
      return this.createResult(
        decision,
        dangerScore,
        'fuzzy_duplicate',
        fuzzyCheck.reason,
        { 
          promptHash, 
          duplicateCount: 0, 
          loopCount: 0, 
          estimatedCost,
          similarity: fuzzyCheck.similarity 
        }
      );
    }

    // Safe request
    this.recordRequest(input, promptHash, false, 0, 'safe', 'Request is safe');
    return this.createResult(
      'allow',
      0,
      'safe',
      'Request is safe',
      { promptHash, duplicateCount: 0, loopCount: 0, estimatedCost }
    );
  }

  /**
   * Detect runaway loops (3+ identical requests in 30 seconds)
   */
  private detectLoop(promptHash: string): { isLoop: boolean; count: number; reason: string } {
    const recent = stateStore.getRecentByHash(promptHash, this.LOOP_WINDOW);
    
    if (recent.length >= this.LOOP_THRESHOLD) {
      return {
        isLoop: true,
        count: recent.length + 1,
        reason: `🔴 KILL SWITCH: RUNAWAY LOOP - ${recent.length + 1} identical requests in 30 seconds`
      };
    }
    
    return { isLoop: false, count: recent.length, reason: '' };
  }

  /**
   * Detect exact duplicates (1+ identical requests in 1 hour)
   */
  private detectDuplicate(promptHash: string): { isDuplicate: boolean; count: number; reason: string } {
    const recent = stateStore.getRecentByHash(promptHash, this.DUPLICATE_WINDOW);
    
    if (recent.length > 0) {
      return {
        isDuplicate: true,
        count: recent.length,
        reason: `💸 DUPLICATE: This exact prompt was sent ${recent.length} time(s) in the last hour`
      };
    }
    
    return { isDuplicate: false, count: 0, reason: '' };
  }

  /**
   * Detect cost spikes ($0.05+)
   */
  private detectCostSpike(estimatedCost: number): { isSpike: boolean; score: number; reason: string } {
    if (estimatedCost >= this.COST_THRESHOLD) {
      const baseScore = 30;
      const costMultiplier = (estimatedCost - 0.05) * 50;
      const score = Math.min(100, baseScore + costMultiplier);
      
      return {
        isSpike: true,
        score,
        reason: `💸 COST SPIKE: Single request costs $${estimatedCost.toFixed(2)}`
      };
    }
    
    return { isSpike: false, score: 0, reason: '' };
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
    
    if (ratio >= this.CONTEXT_RATIO_THRESHOLD) {
      const score = Math.min(75, 25 + Math.log(ratio) * 15);
      
      return {
        isExplosion: true,
        score,
        reason: `💸 CONTEXT EXPLOSION: Context is ${ratio.toFixed(1)}x larger than prompt`,
        ratio
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
    return {
      decision,
      dangerScore,
      category,
      reason,
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
   * Reset state (for testing)
   */
  reset(): void {
    stateStore.reset();
  }
}

// Export singleton instance
export const detectionEngine = DetectionEngine.getInstance();
