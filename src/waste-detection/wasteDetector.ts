import { createHash } from 'crypto';

export interface WasteDetectionResult {
  isWasteful: boolean;
  wasteScore: number; // 0-100
  reason: string;
  suggestions: string[];
  estimatedWaste: number; // in dollars
}

export interface RequestHistory {
  hash: string;
  timestamp: number;
  model: string;
  cost: number;
}

export class WasteDetector {
  private requestHistory: Map<string, RequestHistory[]> = new Map();
  private recentRequests: RequestHistory[] = [];
  private readonly HISTORY_WINDOW = 3600000; // 1 hour in ms
  private readonly RAPID_REQUEST_THRESHOLD = 5; // requests within 30 seconds
  private readonly RAPID_REQUEST_WINDOW = 30000; // 30 seconds

  constructor() {
    // Clean up old history periodically
    setInterval(() => this.cleanupHistory(), 60000) as unknown as NodeJS.Timeout;
  }

  /**
   * Detect if a request is wasteful
   */
  detectWaste(
    model: string,
    prompt: string,
    estimatedCost: number,
    context?: string
  ): WasteDetectionResult {
    const hash = this.hashRequest(prompt, context);
    const now = Date.now();

    // Check for repeated prompts
    const duplicateResult = this.checkDuplicates(hash, model, estimatedCost, now);
    if (duplicateResult.isWasteful) {
      return duplicateResult;
    }

    // Check for rapid repeated calls
    const rapidCallResult = this.checkRapidCalls(hash, now, estimatedCost);
    if (rapidCallResult.isWasteful) {
      return rapidCallResult;
    }

    // Check for large redundant context
    if (context) {
      const contextResult = this.checkRedundantContext(prompt, context, estimatedCost);
      if (contextResult.isWasteful) {
        return contextResult;
      }
    }

    return {
      isWasteful: false,
      wasteScore: 0,
      reason: '',
      suggestions: [],
      estimatedWaste: 0,
    };
  }

  private hashRequest(prompt: string, context?: string): string {
    const data = context ? `${prompt}::${context}` : prompt;
    return createHash('sha256').update(data).digest('hex');
  }

  private checkDuplicates(
    hash: string,
    model: string,
    estimatedCost: number,
    now: number
  ): WasteDetectionResult {
    const history = this.requestHistory.get(hash) || [];
    const recent = history.filter(h => now - h.timestamp < this.HISTORY_WINDOW);

    if (recent.length > 0) {
      const wasteScore = Math.min(90, recent.length * 30);
      return {
        isWasteful: true,
        wasteScore,
        reason: `Duplicate request detected. This prompt has been sent ${recent.length} time(s) in the last hour.`,
        suggestions: [
          'Enable caching for repeated prompts',
          'Store AI responses locally',
          'Use prompt templates to avoid repetition',
        ],
        estimatedWaste: estimatedCost * recent.length,
      };
    }

    return { isWasteful: false, wasteScore: 0, reason: '', suggestions: [], estimatedWaste: 0 };
  }

  private checkRapidCalls(
    hash: string,
    now: number,
    estimatedCost: number
  ): WasteDetectionResult {
    const recent = this.recentRequests.filter(
      r => r.hash === hash && now - r.timestamp < this.RAPID_REQUEST_WINDOW
    );

    if (recent.length >= this.RAPID_REQUEST_THRESHOLD) {
      return {
        isWasteful: true,
        wasteScore: 85,
        reason: `Rapid repeated calls detected. ${recent.length} identical requests in 30 seconds - possible infinite loop.`,
        suggestions: [
          'Check for infinite loops in your code',
          'Add rate limiting',
          'Implement request deduplication',
        ],
        estimatedWaste: estimatedCost * recent.length,
      };
    }

    return { isWasteful: false, wasteScore: 0, reason: '', suggestions: [], estimatedWaste: 0 };
  }

  private checkRedundantContext(
    prompt: string,
    context: string,
    estimatedCost: number
  ): WasteDetectionResult {
    const promptHash = this.hashRequest(prompt);
    const contextHash = this.hashRequest(context);

    // Check if context is much larger than prompt (possible inefficiency)
    const contextRatio = context.length / (prompt.length || 1);
    if (contextRatio > 10) {
      const wastePercent = Math.min(50, contextRatio * 2);
      return {
        isWasteful: true,
        wasteScore: wastePercent,
        reason: `Large context detected. Context is ${contextRatio.toFixed(1)}x larger than prompt.`,
        suggestions: [
          'Remove unnecessary files from context',
          'Summarize context before sending',
          'Use RAG to retrieve only relevant information',
        ],
        estimatedWaste: estimatedCost * (wastePercent / 100),
      };
    }

    // Check for similarity with recent contexts
    const recentContexts = this.recentRequests
      .filter(r => Date.now() - r.timestamp < this.HISTORY_WINDOW)
      .slice(-10);

    for (const recent of recentContexts) {
      const similarity = this.calculateSimilarity(context, context);
      if (similarity > 0.8) {
        return {
          isWasteful: true,
          wasteScore: 60,
          reason: `Highly similar context (${Math.round(similarity * 100)}% overlap) with recent request.`,
          suggestions: [
            'Cache context between requests',
            'Use incremental updates instead of full context',
            'Implement context diffing',
          ],
          estimatedWaste: estimatedCost * 0.5,
        };
      }
    }

    return { isWasteful: false, wasteScore: 0, reason: '', suggestions: [], estimatedWaste: 0 };
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Simple similarity check using word overlap
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  recordRequest(hash: string, model: string, cost: number): void {
    const now = Date.now();
    const record: RequestHistory = { hash, timestamp: now, model, cost };

    // Add to hash-specific history
    if (!this.requestHistory.has(hash)) {
      this.requestHistory.set(hash, []);
    }
    this.requestHistory.get(hash)!.push(record);

    // Add to recent requests
    this.recentRequests.push(record);

    // Keep recent requests manageable
    if (this.recentRequests.length > 1000) {
      this.recentRequests = this.recentRequests.slice(-500);
    }
  }

  private cleanupHistory(): void {
    const now = Date.now();
    
    for (const [hash, history] of this.requestHistory.entries()) {
      const filtered = history.filter(h => now - h.timestamp < this.HISTORY_WINDOW);
      if (filtered.length === 0) {
        this.requestHistory.delete(hash);
      } else {
        this.requestHistory.set(hash, filtered);
      }
    }

    this.recentRequests = this.recentRequests.filter(
      r => now - r.timestamp < this.HISTORY_WINDOW
    );
  }

  getStats() {
    return {
      uniqueRequests: this.requestHistory.size,
      totalRecentRequests: this.recentRequests.length,
    };
  }
}
