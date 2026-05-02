/**
 * GlobalIntelligence.ts - Cross-Customer Learning Network
 * 
 * The PRIMARY moat of the system.
 * 
 * Design:
 * - DO NOT isolate customer data
 * - Build anonymized global intelligence
 * - Every deployment improves all others
 * - Network effects: more users = better detection
 * 
 * Intelligence Types:
 * - Loop signatures (anonymized patterns)
 * - Cost explosion patterns
 * - Attack patterns (prompt injection, etc.)
 * - Behavioral anomalies
 * - Agent failure modes
 * 
 * Privacy:
 * - NO raw prompts stored
 * - NO sensitive data in network
 * - Only pattern signatures and outcomes
 * - Federated learning approach
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';

// Types
export type PatternType = 
  | 'infinite_loop' 
  | 'cost_explosion' 
  | 'retry_storm' 
  | 'redundancy_spike'
  | 'behavioral_anomaly'
  | 'prompt_injection'
  | 'agent_hallucination'
  | 'tool_misuse';

export interface PatternSignature {
  patternId: string;
  type: PatternType;
  inputFingerprint: string; // Hash of input pattern
  sequenceFingerprint: string; // Hash of action sequence
  contextFingerprint: string; // Hash of context pattern
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number; // 0-1
}

export interface GlobalPattern {
  signature: PatternSignature;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrenceCount: number;
  tenantCount: number; // How many distinct tenants have seen this
  averagePreventedCost: number;
  detectionAccuracy: number; // True positive rate
  falsePositiveRate: number;
  relatedPatterns: string[]; // Pattern IDs
  detectionStrategy: 'exact_match' | 'fuzzy_similarity' | 'sequence_match' | 'anomaly';
}

export interface IntelligenceContribution {
  tenantId: string;
  timestamp: number;
  patternType: PatternType;
  patternFingerprint: string;
  outcome: 'detected' | 'prevented' | 'false_positive';
  preventedCost?: number;
  confidence: number;
}

export interface IntelligenceQuery {
  inputFingerprint: string;
  sequenceFingerprint: string;
  contextFingerprint: string;
  tenantId: string;
}

export interface IntelligenceReport {
  matchFound: boolean;
  patterns: GlobalPattern[];
  riskScore: number; // 0-100
  recommendation: string;
  similarExecutions: number; // Global count
  confidence: number;
}

export interface GlobalDetectionImprovement {
  patternType: PatternType;
  weekOverWeekAccuracy: number;
  totalDetections: number;
  truePositives: number;
  falsePositives: number;
  averageConfidence: number;
}

/**
 * Global Intelligence Network
 * 
 * This is the network effect engine.
 * Every customer's anonymized patterns improve detection for all.
 */
export class GlobalIntelligence extends EventEmitter {
  private patterns: Map<string, GlobalPattern>; // patternId -> pattern
  private fingerprintIndex: Map<string, Set<string>>; // fingerprint -> patternIds
  private contributions: IntelligenceContribution[];
  private tenantContributions: Map<string, number>; // tenantId -> contribution count
  private maxContributions: number = 100000;
  
  // Sync state
  private lastSyncAt: number = 0;
  private syncIntervalMs: number = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
    this.patterns = new Map();
    this.fingerprintIndex = new Map();
    this.contributions = [];
    this.tenantContributions = new Map();
    
    // Start background sync
    this.startBackgroundSync();
  }

  /**
   * Analyze intent against global intelligence
   * Returns matching patterns and risk assessment
   */
  analyze(query: IntelligenceQuery): IntelligenceReport {
    const matches: GlobalPattern[] = [];
    const checkedPatterns = new Set<string>();

    // Check input fingerprint matches
    const inputMatches = this.fingerprintIndex.get(query.inputFingerprint) || new Set();
    for (const patternId of inputMatches) {
      if (!checkedPatterns.has(patternId)) {
        checkedPatterns.add(patternId);
        const pattern = this.patterns.get(patternId);
        if (pattern && this.isRelevant(pattern, query)) {
          matches.push(pattern);
        }
      }
    }

    // Check sequence fingerprint matches
    const sequenceMatches = this.fingerprintIndex.get(query.sequenceFingerprint) || new Set();
    for (const patternId of sequenceMatches) {
      if (!checkedPatterns.has(patternId)) {
        checkedPatterns.add(patternId);
        const pattern = this.patterns.get(patternId);
        if (pattern && this.isRelevant(pattern, query)) {
          matches.push(pattern);
        }
      }
    }

    // Calculate aggregate risk
    const riskScore = this.calculateRiskScore(matches);
    const confidence = this.calculateConfidence(matches);

    // Sort by severity and confidence
    matches.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      if (severityOrder[a.signature.severity] !== severityOrder[b.signature.severity]) {
        return severityOrder[a.signature.severity] - severityOrder[b.signature.severity];
      }
      return b.signature.confidence - a.signature.confidence;
    });

    // Generate recommendation
    const recommendation = this.generateRecommendation(matches, riskScore);

    // Count global similar executions
    const similarExecutions = matches.reduce((sum, p) => sum + p.occurrenceCount, 0);

    return {
      matchFound: matches.length > 0,
      patterns: matches.slice(0, 5), // Top 5
      riskScore,
      recommendation,
      similarExecutions,
      confidence,
    };
  }

  /**
   * Contribute anonymized pattern to global intelligence
   * This is how network effects are created
   */
  contribute(contribution: IntelligenceContribution): void {
    // Add to contributions log
    this.contributions.push(contribution);
    
    // Update tenant contribution count
    const currentCount = this.tenantContributions.get(contribution.tenantId) || 0;
    this.tenantContributions.set(contribution.tenantId, currentCount + 1);

    // Trim old contributions
    if (this.contributions.length > this.maxContributions) {
      this.contributions = this.contributions.slice(-this.maxContributions);
    }

    // Update or create pattern
    this.updatePatternFromContribution(contribution);

    // Emit event
    this.emit('intelligence:contribution', contribution);
  }

  /**
   * Record a detection outcome for accuracy tracking
   */
  recordOutcome(
    patternFingerprint: string,
    outcome: 'true_positive' | 'false_positive' | 'missed',
    preventedCost?: number
  ): void {
    const pattern = this.findPatternByFingerprint(patternFingerprint);
    if (!pattern) return;

    if (outcome === 'true_positive') {
      pattern.detectionAccuracy = 
        (pattern.detectionAccuracy * pattern.occurrenceCount + 1) / 
        (pattern.occurrenceCount + 1);
      if (preventedCost) {
        pattern.averagePreventedCost = 
          (pattern.averagePreventedCost * pattern.occurrenceCount + preventedCost) / 
          (pattern.occurrenceCount + 1);
      }
    } else if (outcome === 'false_positive') {
      pattern.falsePositiveRate = 
        (pattern.falsePositiveRate * pattern.occurrenceCount + 1) / 
        (pattern.occurrenceCount + 1);
    }

    pattern.lastSeenAt = Date.now();
    pattern.occurrenceCount++;

    this.emit('intelligence:outcome', { pattern, outcome, preventedCost });
  }

  /**
   * Get detection improvements over time
   */
  getImprovements(timeWindowDays: number = 7): GlobalDetectionImprovement[] {
    const cutoff = Date.now() - (timeWindowDays * 24 * 60 * 60 * 1000);
    const recentContributions = this.contributions.filter(c => c.timestamp > cutoff);

    const byType = new Map<PatternType, IntelligenceContribution[]>();
    
    for (const contrib of recentContributions) {
      const list = byType.get(contrib.patternType) || [];
      list.push(contrib);
      byType.set(contrib.patternType, list);
    }

    const improvements: DetectionImprovement[] = [];

    for (const [type, contribs] of byType) {
      const detected = contribs.filter(c => c.outcome === 'detected').length;
      const prevented = contribs.filter(c => c.outcome === 'prevented').length;
      const falsePos = contribs.filter(c => c.outcome === 'false_positive').length;
      
      const total = detected + prevented + falsePos;
      const truePositives = detected + prevented;
      
      const avgConfidence = contribs.reduce((sum, c) => sum + c.confidence, 0) / contribs.length;

      improvements.push({
        patternType: type,
        weekOverWeekAccuracy: total > 0 ? truePositives / total : 0,
        totalDetections: detected + prevented,
        truePositives,
        falsePositives: falsePos,
        averageConfidence: avgConfidence || 0,
      });
    }

    return improvements;
  }

  /**
   * Get network effect metrics
   */
  getNetworkMetrics(): {
    totalPatterns: number;
    totalContributions: number;
    contributingTenants: number;
    averageImprovementRate: number;
    topPatterns: GlobalPattern[];
  } {
    const patterns = Array.from(this.patterns.values());
    const topPatterns = patterns
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
      .slice(0, 10);

    const improvements = this.getImprovements(30);
    const avgImprovement = improvements.length > 0
      ? improvements.reduce((sum, i) => sum + i.weekOverWeekAccuracy, 0) / improvements.length
      : 0;

    return {
      totalPatterns: patterns.length,
      totalContributions: this.contributions.length,
      contributingTenants: this.tenantContributions.size,
      averageImprovementRate: Math.round(avgImprovement * 100) / 100,
      topPatterns,
    };
  }

  /**
   * Export patterns for sharing (anonymized)
   */
  exportPatterns(patternType?: PatternType, minOccurrences: number = 10): GlobalPattern[] {
    let patterns = Array.from(this.patterns.values());
    
    if (patternType) {
      patterns = patterns.filter(p => p.signature.type === patternType);
    }
    
    return patterns
      .filter(p => p.occurrenceCount >= minOccurrences)
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  }

  /**
   * Import patterns from network
   */
  importPatterns(patterns: GlobalPattern[]): number {
    let imported = 0;
    
    for (const pattern of patterns) {
      const existing = this.patterns.get(pattern.signature.patternId);
      
      if (!existing) {
        // New pattern
        this.patterns.set(pattern.signature.patternId, pattern);
        this.indexPattern(pattern);
        imported++;
      } else {
        // Merge with existing
        existing.occurrenceCount += pattern.occurrenceCount;
        existing.tenantCount = Math.max(existing.tenantCount, pattern.tenantCount);
        existing.lastSeenAt = Math.max(existing.lastSeenAt, pattern.lastSeenAt);
      }
    }

    if (imported > 0) {
      this.emit('intelligence:import', { count: imported });
    }

    return imported;
  }

  /**
   * Sync with global network
   * (Simulated - would connect to central server in production)
   */
  async sync(): Promise<void> {
    const now = Date.now();
    
    if (now - this.lastSyncAt < this.syncIntervalMs) {
      return; // Too soon
    }

    this.lastSyncAt = now;

    // In production: connect to central intelligence server
    // Upload new patterns
    // Download global pattern updates
    // This is where network effects happen

    this.emit('intelligence:sync', {
      timestamp: now,
      patternsExported: this.patterns.size,
      contributionsPending: this.contributions.length,
    });
  }

  /**
   * Generate pattern fingerprint
   */
  fingerprint(input: string, sequence: string[], context: Record<string, any>): {
    inputFingerprint: string;
    sequenceFingerprint: string;
    contextFingerprint: string;
  } {
    return {
      inputFingerprint: this.hash(input.substring(0, 500)),
      sequenceFingerprint: this.hash(sequence.join(':')),
      contextFingerprint: this.hash(JSON.stringify(context)),
    };
  }

  // Private methods

  private isRelevant(pattern: GlobalPattern, query: IntelligenceQuery): boolean {
    // Don't return patterns from same tenant (to avoid feedback loops)
    // In production, would track which tenants contributed to each pattern
    return true;
  }

  private calculateRiskScore(patterns: GlobalPattern[]): number {
    if (patterns.length === 0) return 0;

    const weights = { critical: 100, high: 70, medium: 40, low: 10 };
    
    let totalScore = 0;
    let totalWeight = 0;

    for (const pattern of patterns) {
      const weight = weights[pattern.signature.severity] * pattern.signature.confidence;
      totalScore += weight;
      totalWeight += 100;
    }

    return Math.min(100, totalScore / Math.max(1, totalWeight) * 100);
  }

  private calculateConfidence(patterns: GlobalPattern[]): number {
    if (patterns.length === 0) return 0.5;
    
    const avgConfidence = patterns.reduce((sum, p) => sum + p.signature.confidence, 0) / patterns.length;
    const sampleConfidence = Math.min(1, patterns.length / 10); // More samples = higher confidence
    
    return (avgConfidence + sampleConfidence) / 2;
  }

  private generateRecommendation(patterns: GlobalPattern[], riskScore: number): string {
    if (riskScore >= 80) {
      return `CRITICAL: ${patterns[0]?.signature.type} pattern detected globally ${patterns[0]?.occurrenceCount} times. Strong recommendation to BLOCK.`;
    }
    if (riskScore >= 50) {
      return `HIGH RISK: Similar patterns detected ${patterns.reduce((sum, p) => sum + p.occurrenceCount, 0)} times globally. Consider throttling or additional verification.`;
    }
    if (patterns.length > 0) {
      return `PATTERN MATCH: ${patterns.length} similar patterns found. Monitoring recommended.`;
    }
    return 'No known risk patterns detected.';
  }

  private updatePatternFromContribution(contribution: IntelligenceContribution): void {
    const patternId = contribution.patternFingerprint;
    let pattern = this.patterns.get(patternId);

    if (!pattern) {
      // Create new pattern
      pattern = {
        signature: {
          patternId,
          type: contribution.patternType,
          inputFingerprint: contribution.patternFingerprint,
          sequenceFingerprint: contribution.patternFingerprint,
          contextFingerprint: contribution.patternFingerprint,
          severity: 'medium',
          confidence: contribution.confidence,
        },
        firstSeenAt: contribution.timestamp,
        lastSeenAt: contribution.timestamp,
        occurrenceCount: 1,
        tenantCount: 1,
        averagePreventedCost: contribution.preventedCost || 0,
        detectionAccuracy: contribution.outcome === 'prevented' ? 1 : 0,
        falsePositiveRate: contribution.outcome === 'false_positive' ? 1 : 0,
        relatedPatterns: [],
        detectionStrategy: 'exact_match',
      };

      this.patterns.set(patternId, pattern);
      this.indexPattern(pattern);
    } else {
      // Update existing
      pattern.lastSeenAt = contribution.timestamp;
      pattern.occurrenceCount++;
      
      if (contribution.preventedCost) {
        pattern.averagePreventedCost = 
          (pattern.averagePreventedCost * (pattern.occurrenceCount - 1) + contribution.preventedCost) / 
          pattern.occurrenceCount;
      }
    }
  }

  private indexPattern(pattern: GlobalPattern): void {
    const fingerprints = [
      pattern.signature.inputFingerprint,
      pattern.signature.sequenceFingerprint,
      pattern.signature.contextFingerprint,
    ];

    for (const fp of fingerprints) {
      const set = this.fingerprintIndex.get(fp) || new Set();
      set.add(pattern.signature.patternId);
      this.fingerprintIndex.set(fp, set);
    }
  }

  private findPatternByFingerprint(fingerprint: string): GlobalPattern | undefined {
    const patternIds = this.fingerprintIndex.get(fingerprint);
    if (!patternIds) return undefined;
    
    for (const id of patternIds) {
      return this.patterns.get(id);
    }
    return undefined;
  }

  private hash(input: string): string {
    return createHash('sha256').update(input).digest('hex').substring(0, 32);
  }

  private startBackgroundSync(): void {
    setInterval(() => this.sync(), this.syncIntervalMs);
  }
}

// Export singleton
export const globalIntelligence = new GlobalIntelligence();
