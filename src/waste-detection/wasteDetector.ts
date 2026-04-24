import { createHash } from 'crypto';
import { HistoryStorage, RequestRecord } from '../storage/historyStorage';
import { TrustMode } from '../config';

export interface DetectionResult {
  isDangerous: boolean;
  dangerScore: number; // 0-100
  reason: string;
  suggestions: string[];
  estimatedLoss: number; // in dollars
  severity: 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: 'loop' | 'duplicate' | 'fuzzy_duplicate' | 'context' | 'spike' | 'anomaly';
  killSwitchTriggered: boolean;
}

/**
 * AI Execution Firewall - Advanced Danger Detection Engine
 * Uses fingerprinting, behavioral analysis, fuzzy similarity, and time-window tracking
 */
export class WasteDetector {
  private history: HistoryStorage;
  private readonly RAPID_REQUEST_THRESHOLD = 3; // requests within 30 seconds (reduced from 5 for earlier detection)
  private readonly RAPID_REQUEST_WINDOW = 30000; // 30 seconds
  private readonly ANOMALY_DEVIATION_THRESHOLD = 3; // 3x standard deviation
  private readonly KILL_SWITCH_THRESHOLD = 90; // danger score that triggers kill switch
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.history = new HistoryStorage();
    // Clean up old history periodically
    this.cleanupInterval = setInterval(() => {
      // Trigger cleanup via public method
      const now = Date.now();
      const cutoff = now - 86400000; // 24 hours
      this.history.getRecordsInWindow(86400000); // This triggers internal cleanup
    }, 60000) as unknown as NodeJS.Timeout;
  }

  /**
   * Cleanup method to prevent memory leaks
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.history.destroy();
  }

  /**
   * Detect if a request is dangerous using behavioral analysis
   * Priority: Loop > Duplicate > Fuzzy Duplicate > Context > Spike > Anomaly
   */
  detect(
    model: string,
    prompt: string,
    estimatedCost: number,
    context?: string,
    trustMode: TrustMode = 'warn',
    override: boolean = false
  ): DetectionResult & { action: 'allow' | 'warn' | 'block' } {
    // Input validation
    if (!prompt || typeof prompt !== 'string') {
      return {
        isDangerous: true,
        dangerScore: 100,
        severity: 'CRITICAL',
        reason: 'Invalid prompt: must be a non-empty string',
        suggestions: ['Provide a valid prompt string'],
        killSwitchTriggered: true,
        estimatedLoss: 0,
        category: 'anomaly',
        action: 'block',
      };
    }

    if (typeof estimatedCost !== 'number' || estimatedCost < 0) {
      return {
        isDangerous: true,
        dangerScore: 100,
        severity: 'CRITICAL',
        reason: 'Invalid cost: must be a non-negative number',
        suggestions: ['Provide a valid cost estimate'],
        killSwitchTriggered: true,
        estimatedLoss: 0,
        category: 'anomaly',
        action: 'block',
      };
    }

    const hash = this.fingerprint(prompt, context);
    const now = Date.now();

    // Check 1: Runaway loop (CRITICAL - KILL SWITCH)
    const loopResult = this.detectLoop(hash, now, estimatedCost);
    if (loopResult.isDangerous) {
      this.recordRequest(hash, model, prompt, estimatedCost, context, loopResult, trustMode, override);
      const result = { ...loopResult, action: this.determineAction(loopResult, trustMode, override) };
      // Kill switch: always block loops regardless of trust mode
      if (loopResult.dangerScore >= this.KILL_SWITCH_THRESHOLD) {
        result.action = 'block';
        result.killSwitchTriggered = true;
      }
      return result;
    }

    // Check 2: Exact duplicate detection
    const duplicateResult = this.detectDuplicate(hash, model, estimatedCost, now);
    if (duplicateResult.isDangerous) {
      this.recordRequest(hash, model, prompt, estimatedCost, context, duplicateResult, trustMode, override);
      const result = { ...duplicateResult, action: this.determineAction(duplicateResult, trustMode, override) };
      return result;
    }

    // Check 3: Fuzzy duplicate detection (similar but not identical)
    const fuzzyResult = this.detectFuzzyDuplicate(prompt, model, estimatedCost, now);
    if (fuzzyResult.isDangerous) {
      this.recordRequest(hash, model, prompt, estimatedCost, context, fuzzyResult, trustMode, override);
      const result = { ...fuzzyResult, action: this.determineAction(fuzzyResult, trustMode, override) };
      return result;
    }

    // Check 4: Context explosion
    if (context && prompt) {
      const contextResult = this.detectContextExplosion(prompt, context, estimatedCost);
      if (contextResult.isDangerous) {
        this.recordRequest(hash, model, prompt, estimatedCost, context, contextResult, trustMode, override);
        return { ...contextResult, action: this.determineAction(contextResult, trustMode, override) };
      }
    }

    // Check 5: Cost spike
    const spikeResult = this.detectCostSpike(estimatedCost);
    if (spikeResult.isDangerous) {
      this.recordRequest(hash, model, prompt, estimatedCost, context, spikeResult, trustMode, override);
      const result = { ...spikeResult, action: this.determineAction(spikeResult, trustMode, override) };
      // Kill switch for extreme cost spikes
      if (spikeResult.dangerScore >= this.KILL_SWITCH_THRESHOLD) {
        result.action = 'block';
        result.killSwitchTriggered = true;
      }
      return result;
    }

    // Check 6: Anomaly detection (behavioral deviation)
    const anomalyResult = this.detectAnomaly(hash, estimatedCost, now);
    if (anomalyResult.isDangerous) {
      this.recordRequest(hash, model, prompt, estimatedCost, context, anomalyResult, trustMode, override);
      return { ...anomalyResult, action: this.determineAction(anomalyResult, trustMode, override) };
    }

    // Safe request
    this.recordRequest(hash, model, prompt, estimatedCost, context, null, trustMode, override);
    return {
      isDangerous: false,
      dangerScore: 0,
      severity: 'SAFE',
      reason: 'Request is safe',
      suggestions: [],
      estimatedLoss: 0,
      category: 'anomaly',
      killSwitchTriggered: false,
      action: 'allow',
    };
  }

  private determineAction(result: DetectionResult, trustMode: TrustMode, override: boolean): 'allow' | 'warn' | 'block' {
    if (override) return 'allow';
    if (result.killSwitchTriggered) return 'block'; // Kill switch overrides trust mode
    if (trustMode === 'monitor') return 'allow';
    if (trustMode === 'warn') return 'warn';
    if (trustMode === 'block') return 'block';
    return 'allow';
  }

  /**
   * Detect runaway loops (same request repeated rapidly)
   */
  private detectLoop(hash: string, now: number, estimatedCost: number): DetectionResult {
    const recent = this.history.getRecentRecords(hash, this.RAPID_REQUEST_WINDOW);

    if (recent.length >= this.RAPID_REQUEST_THRESHOLD) {
      const totalLoss = estimatedCost * recent.length;
      // Adaptive threshold: more aggressive with higher counts (base score 90 to hit kill switch immediately)
      const adaptiveScore = Math.min(100, 90 + (recent.length - this.RAPID_REQUEST_THRESHOLD) * 3);

      return {
        isDangerous: true,
        dangerScore: adaptiveScore,
        severity: 'CRITICAL',
        category: 'loop',
        reason: `🔴 KILL SWITCH: RUNAWAY LOOP DETECTED - ${recent.length} identical requests in 30 seconds`,
        suggestions: [
          '🚨 STOP: Check your code for infinite loops or recursive agent calls',
          'Add break condition to your loop',
          'Verify retry logic is not stuck'
        ],
        estimatedLoss: totalLoss,
        killSwitchTriggered: true,
      };
    }

    return { isDangerous: false, dangerScore: 0, severity: 'SAFE', reason: '', suggestions: [], estimatedLoss: 0, category: 'loop', killSwitchTriggered: false };
  }

  /**
   * Detect duplicate requests (same hash within time window)
   */
  private detectDuplicate(hash: string, model: string, estimatedCost: number, now: number): DetectionResult {
    const recent = this.history.getRecentRecords(hash, 3600000); // 1 hour

    if (recent.length > 0) {
      const duplicateCount = recent.length;
      const totalLoss = estimatedCost * duplicateCount;

      const severity = duplicateCount > 5 ? 'CRITICAL' : duplicateCount > 2 ? 'HIGH' : 'MEDIUM';

      return {
        isDangerous: true,
        dangerScore: Math.min(90, 40 + duplicateCount * 10),
        severity,
        category: 'duplicate',
        reason: `💸 DUPLICATE: This exact prompt was sent ${duplicateCount} time(s) in the last hour`,
        suggestions: [
          `Cache this prompt result to avoid ${duplicateCount} redundant calls`,
          'Use a result cache with 1-hour TTL',
          'Check for retry logic causing duplicates'
        ],
        estimatedLoss: totalLoss,
        killSwitchTriggered: false,
      };
    }

    return { isDangerous: false, dangerScore: 0, severity: 'SAFE', reason: '', suggestions: [], estimatedLoss: 0, category: 'duplicate', killSwitchTriggered: false };
  }

  /**
   * Detect fuzzy duplicates (similar but not identical prompts)
   */
  private detectFuzzyDuplicate(prompt: string, model: string, estimatedCost: number, now: number): DetectionResult {
    const recentRecords = this.history.getRecordsInWindow(3600000); // 1 hour
    const SIMILARITY_THRESHOLD = 0.70; // 70% similarity threshold (lowered from 85%)

    // Skip if this exact prompt already triggered duplicate detection
    const exactMatches = this.history.getRecentRecords(this.fingerprint(prompt, ''), 3600000);
    if (exactMatches.length > 0) {
      return { isDangerous: false, dangerScore: 0, severity: 'SAFE', reason: '', suggestions: [], estimatedLoss: 0, category: 'fuzzy_duplicate', killSwitchTriggered: false };
    }

    let maxSimilarity = 0;
    let bestMatch: RequestRecord | null = null;

    for (const record of recentRecords) {
      // Skip exact matches (already handled by duplicate detection)
      if (record.prompt === prompt) continue;
      
      const similarity = this.calculateSimilarity(prompt, record.prompt);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        bestMatch = record;
      }
      
      if (similarity >= SIMILARITY_THRESHOLD) {
        const totalLoss = estimatedCost * (recentRecords.length + 1) / 2; // Estimate
        
        return {
          isDangerous: true,
          dangerScore: Math.min(70, 30 + similarity * 40),
          severity: 'MEDIUM',
          category: 'fuzzy_duplicate',
          reason: `⚠️ SIMILAR PROMPT: ${(similarity * 100).toFixed(0)}% similar to a recent request`,
          suggestions: [
            'Consider if this variation is necessary',
            'Use a cache key that handles similar requests',
            'Review prompt generation logic'
          ],
          estimatedLoss: totalLoss * 0.5, // Conservative estimate
          killSwitchTriggered: false,
        };
      }
    }

    return { isDangerous: false, dangerScore: 0, severity: 'SAFE', reason: '', suggestions: [], estimatedLoss: 0, category: 'fuzzy_duplicate', killSwitchTriggered: false };
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const len1 = Math.min(str1.length, 500); // Limit for performance
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
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    return 1 - distance / maxLength;
  }

  /**
   * Detect context explosion (oversized context relative to prompt)
   */
  private detectContextExplosion(prompt: string, context: string, estimatedCost: number): DetectionResult {
    const promptLength = prompt.length;
    const contextLength = context.length;
    const contextRatio = contextLength / (promptLength || 1);
    const contextPercentage = (contextLength / (promptLength + contextLength)) * 100;

    if (contextRatio >= 20) {
      const wastePercentage = Math.min(55, Math.log(contextRatio) * 15);
      const estimatedLoss = estimatedCost * (wastePercentage / 100);

      return {
        isDangerous: true,
        dangerScore: Math.min(75, 30 + wastePercentage),
        severity: contextRatio >= 50 ? 'CRITICAL' : 'HIGH',
        category: 'context',
        reason: `💸 CONTEXT EXPLOSION: Context is ${contextRatio.toFixed(1)}x larger than prompt (${contextPercentage.toFixed(0)}% of total)`,
        suggestions: [
          `Trim context from ${Math.round(contextLength / 1024)}KB to < ${Math.round(contextLength / 1024 / 5)}KB`,
          'Extract only relevant sections',
          'Use RAG to retrieve smaller relevant chunks'
        ],
        estimatedLoss,
        killSwitchTriggered: false,
      };
    }

    if (contextRatio >= 5) {
      const wastePercentage = Math.log(contextRatio) * 10;
      const estimatedLoss = estimatedCost * (wastePercentage / 100);

      return {
        isDangerous: true,
        dangerScore: Math.min(70, 25 + wastePercentage),
        severity: 'HIGH',
        category: 'context',
        reason: `⚠️ ABNORMAL CONTEXT SIZE: Context is ${contextRatio.toFixed(1)}x larger than prompt`,
        suggestions: [
          'Reduce context size by removing redundant information',
          'Summarize context before sending',
          'Use embedding-based retrieval for efficiency'
        ],
        estimatedLoss,
        killSwitchTriggered: false,
      };
    }

    return { isDangerous: false, dangerScore: 0, severity: 'SAFE', reason: '', suggestions: [], estimatedLoss: 0, category: 'context', killSwitchTriggered: false };
  }

  /**
   * Detect cost spikes (single expensive request)
   */
  private detectCostSpike(estimatedCost: number): DetectionResult {
    // Trigger warnings starting at $0.05, critical at $1.0+
    if (estimatedCost >= 0.05) {
      const baseScore = 30;
      const costMultiplier = (estimatedCost - 0.05) * 50; // Scale increases sharply with cost
      const dangerScore = Math.min(100, baseScore + costMultiplier);
      const isKillSwitch = dangerScore >= this.KILL_SWITCH_THRESHOLD;

      return {
        isDangerous: true,
        dangerScore,
        severity: estimatedCost > 1.0 ? 'CRITICAL' : estimatedCost >= 0.5 ? 'HIGH' : 'MEDIUM',
        category: 'spike',
        reason: isKillSwitch ? `🔴 KILL SWITCH: EXTREME COST - $${estimatedCost.toFixed(2)}` : `💸 COST SPIKE: Single request costs $${estimatedCost.toFixed(2)}` + (estimatedCost < 0.1 ? ' (production threshold)' : ''),
        suggestions: [
          'Consider if this really needs to be done now',
          'Use a cheaper model (gpt-4o-mini, claude-haiku)',
          'Break into multiple smaller requests'
        ],
        estimatedLoss: estimatedCost * 0.5,
        killSwitchTriggered: isKillSwitch,
      };
    }

    return { isDangerous: false, dangerScore: 0, severity: 'SAFE', reason: '', suggestions: [], estimatedLoss: 0, category: 'spike', killSwitchTriggered: false };
  }

  /**
   * Detect anomalies (behavioral deviation from normal usage)
   */
  private detectAnomaly(hash: string, estimatedCost: number, now: number): DetectionResult {
    const recentRecords = this.history.getRecordsInWindow(3600000); // 1 hour
    
    if (recentRecords.length < 10) {
      // Not enough data for anomaly detection
      return { isDangerous: false, dangerScore: 0, severity: 'SAFE', reason: '', suggestions: [], estimatedLoss: 0, category: 'anomaly', killSwitchTriggered: false };
    }

    const costs = recentRecords.map(r => r.estimatedCost);
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    const variance = costs.reduce((sum, cost) => sum + Math.pow(cost - mean, 2), 0) / costs.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev > 0 && estimatedCost > mean + this.ANOMALY_DEVIATION_THRESHOLD * stdDev) {
      const deviation = ((estimatedCost - mean) / stdDev).toFixed(1);

      return {
        isDangerous: true,
        dangerScore: Math.min(60, 30 + parseFloat(deviation) * 5),
        severity: 'MEDIUM',
        category: 'anomaly',
        reason: `⚠️ ANOMALY: Cost is ${deviation}x standard deviation above normal`,
        suggestions: [
          'Review if this request pattern is expected',
          'Check for unusual data being processed',
          'Monitor for similar requests'
        ],
        estimatedLoss: estimatedCost - mean,
        killSwitchTriggered: false,
      };
    }

    return { isDangerous: false, dangerScore: 0, severity: 'SAFE', reason: '', suggestions: [], estimatedLoss: 0, category: 'anomaly', killSwitchTriggered: false };
  }

  /**
   * Record request to history
   */
  private recordRequest(
    hash: string,
    model: string,
    prompt: string,
    estimatedCost: number,
    context: string | undefined,
    detectionResult: DetectionResult | null,
    trustMode: TrustMode,
    override: boolean
  ): void {
    const record: RequestRecord = {
      id: `${hash}-${Date.now()}`,
      hash,
      model,
      prompt,
      context,
      estimatedCost,
      timestamp: Date.now(),
      wasBlocked: Boolean(detectionResult?.isDangerous && (trustMode === 'block' || detectionResult.killSwitchTriggered) && !override),
      wasWarned: Boolean(detectionResult?.isDangerous && trustMode === 'warn' && !detectionResult.killSwitchTriggered && !override),
      dangerScore: detectionResult?.dangerScore || 0,
      reason: detectionResult?.reason,
    };

    this.history.addRecord(record);
  }

  /**
   * Create request fingerprint (hash of prompt + context)
   */
  private fingerprint(prompt: string, context?: string): string {
    const data = context ? `${prompt}::${context}` : prompt;
    return createHash('sha256').update(data).digest('hex').substring(0, 12);
  }

  /**
   * Get statistics
   */
  getStats(hours: number = 24) {
    return this.history.getStats(hours);
  }

  /**
   * Get blocked requests
   */
  getBlockedRequests(limit: number = 10) {
    return this.history.getBlockedRequests(limit);
  }
}
