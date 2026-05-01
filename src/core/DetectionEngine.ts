/**
 * DetectionEngine.ts - SINGLE Core Detection Engine
 *
 * Input (CLI/SDK/Proxy) -> DetectionEngine.analyze() -> Result
 */

import { randomUUID } from 'crypto';
import { stateStore, RequestRecord } from './StateStore';
import { DETECTION_THRESHOLDS, TIME_WINDOWS } from '../config/constants';
import { policyEngine } from './PolicyEngine';
import { FirewallMetadata, TokenBreakdown } from './types';
import { alertManager } from './AlertManager';

export type Decision = 'allow' | 'warn' | 'block';
export type Category = 'loop' | 'duplicate' | 'fuzzy_duplicate' | 'context' | 'spike' | 'budget' | 'safe' | 'invalid';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DetectionResult {
  decision: Decision;
  dangerScore: number;
  riskLevel: RiskLevel;
  category: Category;
  reason: string;
  saved: number;
  wouldHaveLost: number;
  metadata: {
    promptHash: string;
    duplicateCount: number;
    loopCount: number;
    estimatedCost: number;
    similarity?: number;
    contextRatio?: number;
    requestId?: string;
    policyId?: string;
  };
}

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
  metadata?: FirewallMetadata;
  tokens?: TokenBreakdown;
  onBlock?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onWarn?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onSpike?: (requests: number, timeWindow: number) => void;
}

export interface AlertHooks {
  onBlock?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onWarn?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onSpike?: (requests: number, timeWindow: number) => void;
}

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

  analyze(input: AnalyzeInput): DetectionResult {
    const { model, prompt, estimatedCost, context, trustMode = 'warn', override = false } = input;
    const requestId = String(input.metadata?.requestId || randomUUID());
    const metadata: FirewallMetadata = {
      ...(input.metadata || {}),
      requestId,
      model,
    };

    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return this.createResult('block', 100, 'invalid', 'Invalid prompt: must be a non-empty string', {
        promptHash: '',
        duplicateCount: 0,
        loopCount: 0,
        estimatedCost: 0,
        requestId,
      });
    }

    if (typeof estimatedCost !== 'number' || estimatedCost < 0) {
      return this.createResult('block', 100, 'invalid', 'Invalid cost: must be a non-negative number', {
        promptHash: '',
        duplicateCount: 0,
        loopCount: 0,
        estimatedCost: 0,
        requestId,
      });
    }

    if (override) {
      const hash = stateStore.generateHash(prompt, context);
      this.recordRequest(input, hash, false, 0, 'safe', 'Override enabled', 'allow', metadata);
      return this.createResult('allow', 0, 'safe', 'Override enabled - request allowed', {
        promptHash: hash,
        duplicateCount: 0,
        loopCount: 0,
        estimatedCost,
        requestId,
      });
    }

    const promptHash = stateStore.generateHash(prompt, context);
    const effectivePolicy = policyEngine.getEffectivePolicy(metadata);

    const loopCheck = this.detectLoop(promptHash);
    if (loopCheck.isLoop) {
      const dangerScore = Math.min(100, 90 + (loopCheck.count - 2) * 3);
      this.recordRequest(input, promptHash, true, dangerScore, 'loop', loopCheck.reason, 'block', metadata);
      return this.createResult('block', dangerScore, 'loop', loopCheck.reason, {
        promptHash,
        duplicateCount: 0,
        loopCount: loopCheck.count,
        estimatedCost,
        requestId,
        policyId: effectivePolicy.id,
      });
    }

    const duplicateCheck = this.detectDuplicate(promptHash);
    if (duplicateCheck.isDuplicate) {
      const dangerScore = Math.min(90, 30 + duplicateCheck.count * 10);
      const decision = this.determineDecision(dangerScore, trustMode);
      this.triggerHooks(decision, 'duplicate', duplicateCheck.reason, dangerScore, estimatedCost, input);
      this.recordRequest(input, promptHash, true, dangerScore, 'duplicate', duplicateCheck.reason, decision, metadata);
      return this.createResult(decision, dangerScore, 'duplicate', duplicateCheck.reason, {
        promptHash,
        duplicateCount: duplicateCheck.count,
        loopCount: loopCheck.count,
        estimatedCost,
        requestId,
        policyId: effectivePolicy.id,
      });
    }

    const policyCheck = policyEngine.evaluate({
      model,
      estimatedCost,
      metadata,
      tokens: input.tokens,
    });
    const isLegacyDefaultPerRequest =
      policyCheck.effectivePolicy.id === 'default' && policyCheck.reason.startsWith('PER-REQUEST');
    if (policyCheck.decision !== 'allow' && !isLegacyDefaultPerRequest) {
      const dangerScore = policyCheck.dangerScore;
      const decision = policyCheck.decision === 'block' ? 'block' : this.determineDecision(dangerScore, trustMode);
      this.triggerHooks(decision, 'budget', policyCheck.reason, dangerScore, estimatedCost, input);
      this.recordRequest(input, promptHash, true, dangerScore, 'budget', policyCheck.reason, decision, metadata);
      return this.createResult(decision, dangerScore, 'budget', policyCheck.reason, {
        promptHash,
        duplicateCount: 0,
        loopCount: loopCheck.count,
        estimatedCost,
        requestId,
        policyId: policyCheck.effectivePolicy.id,
      });
    }

    const costCheck = this.detectCostSpike(estimatedCost);
    if (costCheck.isSpike) {
      const dangerScore = costCheck.score;
      const decision = this.determineDecision(dangerScore, trustMode);
      if (input.onSpike) {
        input.onSpike(1, 60);
      }
      this.triggerHooks(decision, 'spike', costCheck.reason, dangerScore, estimatedCost, input);
      this.recordRequest(input, promptHash, true, dangerScore, 'spike', costCheck.reason, decision, metadata);
      return this.createResult(decision, dangerScore, 'spike', costCheck.reason, {
        promptHash,
        duplicateCount: 0,
        loopCount: loopCheck.count,
        estimatedCost,
        requestId,
        policyId: effectivePolicy.id,
      });
    }

    if (context) {
      const contextCheck = this.detectContextExplosion(prompt, context);
      if (contextCheck.isExplosion) {
        const dangerScore = contextCheck.score;
        const decision = this.determineDecision(dangerScore, trustMode);
        this.triggerHooks(decision, 'context', contextCheck.reason, dangerScore, estimatedCost, input);
        this.recordRequest(input, promptHash, true, dangerScore, 'context', contextCheck.reason, decision, metadata);
        return this.createResult(decision, dangerScore, 'context', contextCheck.reason, {
          promptHash,
          duplicateCount: 0,
          loopCount: loopCheck.count,
          estimatedCost,
          contextRatio: contextCheck.ratio,
          requestId,
          policyId: effectivePolicy.id,
        });
      }
    }

    const fuzzyCheck = this.detectFuzzyDuplicate(prompt);
    if (fuzzyCheck.isFuzzy) {
      const dangerScore = Math.min(70, 30 + fuzzyCheck.similarity * 40);
      const decision = this.determineDecision(dangerScore, trustMode);
      this.triggerHooks(decision, 'fuzzy_duplicate', fuzzyCheck.reason, dangerScore, estimatedCost, input);
      this.recordRequest(
        input,
        promptHash,
        true,
        dangerScore,
        'fuzzy_duplicate',
        fuzzyCheck.reason,
        decision,
        metadata
      );
      return this.createResult(decision, dangerScore, 'fuzzy_duplicate', fuzzyCheck.reason, {
        promptHash,
        duplicateCount: 0,
        loopCount: loopCheck.count,
        estimatedCost,
        similarity: fuzzyCheck.similarity,
        requestId,
        policyId: effectivePolicy.id,
      });
    }

    this.recordRequest(input, promptHash, false, 0, 'safe', 'Request is safe', 'allow', metadata);
    return this.createResult('allow', 0, 'safe', 'Request is safe', {
      promptHash,
      duplicateCount: 0,
      loopCount: loopCheck.count,
      estimatedCost,
      requestId,
      policyId: effectivePolicy.id,
    });
  }

  private detectLoop(promptHash: string): { isLoop: boolean; count: number; reason: string } {
    const recent = stateStore.getRecentByHash(promptHash, this.LOOP_WINDOW);
    const totalCount = recent.length + 1;
    if (totalCount >= this.LOOP_THRESHOLD) {
      return {
        isLoop: true,
        count: totalCount,
        reason: `KILL SWITCH: RUNAWAY LOOP - ${totalCount} identical requests in 30 seconds`,
      };
    }

    return { isLoop: false, count: recent.length, reason: '' };
  }

  private detectDuplicate(promptHash: string): { isDuplicate: boolean; count: number; reason: string } {
    const recent = stateStore.getRecentByHash(promptHash, this.DUPLICATE_WINDOW);
    if (recent.length > 0) {
      return {
        isDuplicate: true,
        count: recent.length,
        reason: `DUPLICATE: This exact prompt was sent ${recent.length} time(s) in the last hour`,
      };
    }

    return { isDuplicate: false, count: recent.length, reason: '' };
  }

  private detectCostSpike(estimatedCost: number): { isSpike: boolean; score: number; reason: string } {
    if (estimatedCost >= this.COST_THRESHOLD) {
      const baseScore = 30;
      const costMultiplier = (estimatedCost - 0.05) * 50;
      const score = Math.min(100, Math.floor(baseScore + costMultiplier));

      return {
        isSpike: true,
        score,
        reason: `COST SPIKE: Single request costs $${estimatedCost.toFixed(2)}`,
      };
    }

    return { isSpike: false, score: 0, reason: '' };
  }

  private detectContextExplosion(
    prompt: string,
    context: string
  ): { isExplosion: boolean; score: number; reason: string; ratio: number } {
    const promptLength = prompt.length;
    const contextLength = context.length;
    const ratio = contextLength / (promptLength || 1);

    if (ratio >= this.CONTEXT_RATIO_THRESHOLD) {
      const roundedRatio = Math.floor(ratio * 100) / 100;
      const score = Math.min(75, Math.floor(25 + Math.log(ratio) * 15));

      return {
        isExplosion: true,
        score,
        reason: `CONTEXT EXPLOSION: Context is ${roundedRatio.toFixed(2)}x larger than prompt`,
        ratio: roundedRatio,
      };
    }

    return { isExplosion: false, score: 0, reason: '', ratio };
  }

  private detectFuzzyDuplicate(prompt: string): {
    isFuzzy: boolean;
    similarity: number;
    reason: string;
  } {
    const recentRecords = stateStore.getAllRecent(this.DUPLICATE_WINDOW);

    for (const record of recentRecords) {
      if (record.prompt === prompt) continue;

      const similarity = stateStore.calculateSimilarity(prompt, record.prompt);

      if (similarity >= this.FUZZY_THRESHOLD) {
        return {
          isFuzzy: true,
          similarity,
          reason: `SIMILAR PROMPT: ${(similarity * 100).toFixed(0)}% similar to a recent request`,
        };
      }
    }

    return { isFuzzy: false, similarity: 0, reason: '' };
  }

  private determineDecision(dangerScore: number, trustMode: string): Decision {
    if (dangerScore >= this.KILL_SWITCH_THRESHOLD) return 'block';
    if (trustMode === 'monitor') return 'allow';
    if (trustMode === 'warn') return 'warn';
    if (trustMode === 'block') return 'block';
    return 'allow';
  }

  private triggerHooks(
    decision: Decision,
    category: Category,
    reason: string,
    dangerScore: number,
    estimatedCost: number,
    input: AnalyzeInput
  ): void {
    alertManager.notify({
      decision,
      riskLevel: getRiskLevel(dangerScore),
      dangerScore,
      category,
      reason,
      estimatedCost,
      metadata: input.metadata,
    });

    if (decision === 'block' && input.onBlock) {
      input.onBlock(reason, dangerScore, estimatedCost);
    } else if (decision === 'warn' && input.onWarn) {
      input.onWarn(reason, dangerScore, estimatedCost);
    }
  }

  private createResult(
    decision: Decision,
    dangerScore: number,
    category: Category,
    reason: string,
    metadata: DetectionResult['metadata']
  ): DetectionResult {
    const normalizedScore = Math.max(0, Math.min(100, Math.floor(dangerScore)));
    const riskLevel = getRiskLevel(normalizedScore);
    const saved = decision === 'block' ? metadata.estimatedCost : 0;

    const stats = stateStore.getStats(24);
    const historicalBlockedCost =
      stats.blockedRequests > 0 ? (stats.totalCost / (stats.totalRequests || 1)) * stats.blockedRequests : 0;
    const wouldHaveLost = stats.totalCost + historicalBlockedCost + saved;

    return {
      decision,
      dangerScore: normalizedScore,
      riskLevel,
      category,
      reason,
      saved: Math.round(saved * 10000) / 10000,
      wouldHaveLost: Math.round(wouldHaveLost * 10000) / 10000,
      metadata,
    };
  }

  private recordRequest(
    input: AnalyzeInput,
    promptHash: string,
    isDangerous: boolean,
    dangerScore: number,
    category: Category,
    reason: string,
    decision: Decision,
    metadata: FirewallMetadata
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
      wasBlocked: decision === 'block',
      wasWarned: decision === 'warn',
      reason,
      context: input.context,
      metadata,
      tokens: input.tokens,
      decision,
    };

    stateStore.addRecord(record);
  }

  getStats(hours: number = 24) {
    return stateStore.getStats(hours);
  }

  getBlocked(limit: number = 10) {
    return stateStore.getBlocked(limit);
  }

  clear(): void {
    stateStore.clear();
  }

  reset(): void {
    stateStore.reset();
  }

  getBudgetStatus(metadata: FirewallMetadata = {}) {
    return policyEngine.getBudgetStatus(metadata);
  }

  explainDecision(result: DetectionResult): string {
    const request = result.metadata.requestId ? ` request ${result.metadata.requestId}` : '';
    return `AIFW ${result.decision}ed${request} because ${result.reason}. Category=${result.category}, risk=${result.riskLevel.toLowerCase()}, score=${result.dangerScore}, saved=$${result.saved.toFixed(4)}.`;
  }
}

export const detectionEngine = DetectionEngine.getInstance();
