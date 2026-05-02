/**
 * LearningSystem.ts - Behavioral Dataset Moat
 * 
 * Stores anonymized execution patterns:
 * - Loops and failure patterns
 * - Cost explosions  
 * - Anomalous agent behaviors
 * 
 * This is the ONLY long-term defensibility layer.
 * Improves detection accuracy over time without storing raw sensitive data.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AnonymizedPattern {
  id: string;
  timestamp: number;
  patternType: 'loop' | 'cost_explosion' | 'retry_storm' | 'redundancy' | 'anomaly';
  // Fingerprint (not raw data)
  inputHash: string; // Hash of input pattern, not content
  actionSequenceHash: string; // Hash of action types sequence
  // Metrics (not content)
  actionCount: number;
  durationMs: number;
  totalCost: number;
  depth: number;
  branchFactor: number;
  // Outcome
  outcome: 'blocked' | 'throttled' | 'completed' | 'failed';
  preventedCost: number;
  // Model version for tracking improvements
  detectionVersion: string;
  confidence: number;
}

export interface PatternSignature {
  inputHash: string;
  actionSequenceHash: string;
  patternType: string;
}

export interface DetectionImprovement {
  patternType: string;
  version: string;
  totalDetections: number;
  truePositives: number;
  falsePositives: number;
  accuracy: number;
  averageConfidence: number;
}

export interface CommunityPattern {
  patternHash: string;
  patternType: string;
  occurrenceCount: number;
  averageCost: number;
  detectionStrategy: string;
  contributedBy: string; // anonymized contributor id
}

/**
 * Learning System - Dataset Moat
 * 
 * Design principles:
 * 1. NO raw sensitive data stored (only hashes and metrics)
 * 2. Patterns improve detection algorithms
 * 3. Community contributions strengthen the moat
 * 4. Exportable for research/compliance
 */
export class LearningSystem {
  private dataDir: string;
  private patternsFile: string;
  private improvementsFile: string;
  private patterns: Map<string, AnonymizedPattern[]>; // patternType -> patterns
  private maxPatternsPerType: number = 10000;
  private currentVersion: string = '1.0.0';

  constructor() {
    this.dataDir = path.join(os.homedir(), '.ai-execution-firewall', 'learning');
    this.patternsFile = path.join(this.dataDir, 'patterns.json');
    this.improvementsFile = path.join(this.dataDir, 'improvements.json');
    this.patterns = new Map();
    this.ensureDirectory();
    this.loadPatterns();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadPatterns(): void {
    try {
      if (fs.existsSync(this.patternsFile)) {
        const data = JSON.parse(fs.readFileSync(this.patternsFile, 'utf8'));
        for (const [type, patterns] of Object.entries(data)) {
          this.patterns.set(type, patterns as AnonymizedPattern[]);
        }
      }
    } catch (e) {
      console.error('Error loading patterns:', e);
    }
  }

  private savePatterns(): void {
    try {
      const data: Record<string, AnonymizedPattern[]> = {};
      for (const [type, patterns] of this.patterns) {
        data[type] = patterns;
      }
      fs.writeFileSync(this.patternsFile, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Error saving patterns:', e);
    }
  }

  /**
   * Record an anonymized pattern
   * No raw sensitive data is stored - only fingerprints and metrics
   */
  recordPattern(params: {
    patternType: AnonymizedPattern['patternType'];
    input: string;
    actionSequence: string[];
    actionCount: number;
    durationMs: number;
    totalCost: number;
    depth: number;
    branchFactor: number;
    outcome: AnonymizedPattern['outcome'];
    preventedCost: number;
    confidence: number;
  }): AnonymizedPattern {
    const pattern: AnonymizedPattern = {
      id: this.generateId(),
      timestamp: Date.now(),
      patternType: params.patternType,
      inputHash: this.hashString(params.input.substring(0, 200)),
      actionSequenceHash: this.hashString(params.actionSequence.join(':')),
      actionCount: params.actionCount,
      durationMs: params.durationMs,
      totalCost: params.totalCost,
      depth: params.depth,
      branchFactor: params.branchFactor,
      outcome: params.outcome,
      preventedCost: params.preventedCost,
      detectionVersion: this.currentVersion,
      confidence: params.confidence,
    };

    const typePatterns = this.patterns.get(params.patternType) || [];
    typePatterns.push(pattern);

    // Keep only most recent patterns per type
    if (typePatterns.length > this.maxPatternsPerType) {
      typePatterns.splice(0, typePatterns.length - this.maxPatternsPerType);
    }

    this.patterns.set(params.patternType, typePatterns);
    this.savePatterns();

    return pattern;
  }

  /**
   * Find similar patterns
   * Used to improve detection confidence
   */
  findSimilarPatterns(
    input: string,
    actionSequence: string[],
    patternType?: string
  ): AnonymizedPattern[] {
    const inputHash = this.hashString(input.substring(0, 200));
    const actionHash = this.hashString(actionSequence.join(':'));

    const results: AnonymizedPattern[] = [];

    const typesToSearch = patternType ? [patternType] : Array.from(this.patterns.keys());

    for (const type of typesToSearch) {
      const patterns = this.patterns.get(type) || [];
      
      for (const pattern of patterns) {
        // Match on input hash or action sequence
        if (pattern.inputHash === inputHash || pattern.actionSequenceHash === actionHash) {
          results.push(pattern);
        }
      }
    }

    // Sort by confidence and recency
    return results
      .sort((a, b) => b.confidence - a.confidence || b.timestamp - a.timestamp)
      .slice(0, 10);
  }

  /**
   * Get detection improvement metrics
   */
  getImprovements(): DetectionImprovement[] {
    const improvements: DetectionImprovement[] = [];

    for (const [patternType, patterns] of this.patterns) {
      if (patterns.length === 0) continue;

      const blocked = patterns.filter(p => p.outcome === 'blocked').length;
      const throttled = patterns.filter(p => p.outcome === 'throttled').length;
      const completed = patterns.filter(p => p.outcome === 'completed').length;
      const failed = patterns.filter(p => p.outcome === 'failed').length;

      // True positives: blocked/throttled that would have been costly
      const truePositives = patterns.filter(
        p => (p.outcome === 'blocked' || p.outcome === 'throttled') && p.preventedCost > 0
      ).length;

      // False positives: blocked/throttled that completed successfully elsewhere
      // (this is an approximation - real FP requires labeled data)
      const falsePositives = patterns.filter(
        p => (p.outcome === 'blocked' || p.outcome === 'throttled') && p.preventedCost === 0
      ).length;

      const total = patterns.length;
      const accuracy = total > 0 ? truePositives / (truePositives + falsePositives || 1) : 0;
      const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / total;

      improvements.push({
        patternType,
        version: this.currentVersion,
        totalDetections: total,
        truePositives,
        falsePositives,
        accuracy: Math.round(accuracy * 100) / 100,
        averageConfidence: Math.round(avgConfidence * 100) / 100,
      });
    }

    return improvements;
  }

  /**
   * Get patterns for export (anonymized)
   * Can be shared with community for research
   */
  exportPatterns(patternType?: string, limit: number = 1000): AnonymizedPattern[] {
    const results: AnonymizedPattern[] = [];

    const types = patternType ? [patternType] : Array.from(this.patterns.keys());
    
    for (const type of types) {
      const patterns = this.patterns.get(type) || [];
      results.push(...patterns.slice(-limit));
    }

    return results.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /**
   * Import community patterns
   * Strengthens the moat with collective knowledge
   */
  importCommunityPatterns(communityPatterns: CommunityPattern[]): number {
    let imported = 0;

    for (const cp of communityPatterns) {
      // Check if we already have this pattern
      const existing = this.findPatternByHash(cp.patternHash);
      
      if (!existing) {
        // Create synthetic pattern from community data
        const pattern: AnonymizedPattern = {
          id: this.generateId(),
          timestamp: Date.now(),
          patternType: cp.patternType as any,
          inputHash: cp.patternHash,
          actionSequenceHash: cp.patternHash,
          actionCount: 0,
          durationMs: 0,
          totalCost: cp.averageCost,
          depth: 0,
          branchFactor: 0,
          outcome: 'blocked',
          preventedCost: cp.averageCost,
          detectionVersion: 'community',
          confidence: 0.7,
        };

        const typePatterns = this.patterns.get(cp.patternType) || [];
        typePatterns.push(pattern);
        this.patterns.set(cp.patternType, typePatterns);
        imported++;
      }
    }

    if (imported > 0) {
      this.savePatterns();
    }

    return imported;
  }

  /**
   * Get pattern statistics
   */
  getStats(): {
    totalPatterns: number;
    patternsByType: Record<string, number>;
    totalPreventedCost: number;
    averageAccuracy: number;
  } {
    let totalPatterns = 0;
    let totalPreventedCost = 0;
    let totalAccuracy = 0;
    const patternsByType: Record<string, number> = {};

    for (const [type, patterns] of this.patterns) {
      totalPatterns += patterns.length;
      patternsByType[type] = patterns.length;
      totalPreventedCost += patterns.reduce((sum, p) => sum + p.preventedCost, 0);
      
      const typeAccuracy = patterns.filter(
        p => p.outcome === 'blocked' && p.preventedCost > 0
      ).length / (patterns.length || 1);
      totalAccuracy += typeAccuracy;
    }

    const typeCount = this.patterns.size;
    const averageAccuracy = typeCount > 0 ? totalAccuracy / typeCount : 0;

    return {
      totalPatterns,
      patternsByType,
      totalPreventedCost: Math.round(totalPreventedCost * 100) / 100,
      averageAccuracy: Math.round(averageAccuracy * 100) / 100,
    };
  }

  /**
   * Clear all patterns
   */
  clear(): void {
    this.patterns.clear();
    this.savePatterns();
  }

  private findPatternByHash(hash: string): AnonymizedPattern | undefined {
    for (const patterns of this.patterns.values()) {
      const found = patterns.find(p => p.inputHash === hash || p.actionSequenceHash === hash);
      if (found) return found;
    }
    return undefined;
  }

  private hashString(str: string): string {
    // Simple hash for demonstration
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private generateId(): string {
    return `pattern-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton
export const learningSystem = new LearningSystem();
