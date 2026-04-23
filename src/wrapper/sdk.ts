import { WasteDetector } from '../waste-detection';
import { Logger, LogEntry } from '../logger';
import { estimateTokens, estimateMessagesTokens } from '../token-counter';
import { estimateCost, getModelPricing } from '../config';
import { ConfigManager } from '../config';
import { createHash } from 'crypto';

export interface AIRequestOptions {
  model: string;
  prompt?: string;
  messages?: any[];
  context?: string;
  overrideBlock?: boolean;
}

export interface AIResponse {
  success: boolean;
  blocked?: boolean;
  data?: any;
  wasteScore?: number;
  reason?: string;
  suggestions?: string[];
  estimatedCost?: number;
}

export class AIWasteGuard {
  private wasteDetector: WasteDetector;
  private logger: Logger;
  private config: ConfigManager;

  constructor() {
    this.wasteDetector = new WasteDetector();
    this.logger = new Logger();
    this.config = new ConfigManager();
  }

  /**
   * Call an AI API with waste detection
   * @param apiCall - The actual API call function (e.g., openai.chat.completions.create)
   * @param options - Request options
   */
  async call<T = any>(
    apiCall: () => Promise<T>,
    options: AIRequestOptions
  ): Promise<AIResponse & { data?: T }> {
    const { model, prompt, messages, context, overrideBlock } = options;
    
    // Determine the text to analyze
    const textToAnalyze = prompt || JSON.stringify(messages || '');
    
    // Estimate tokens and cost
    const inputTokens = messages 
      ? estimateMessagesTokens(messages)
      : estimateTokens(prompt || '');
    
    const pricing = getModelPricing(model);
    if (!pricing) {
      console.warn(`Unknown model: ${model}, allowing request`);
      const data = await apiCall();
      return { success: true, data };
    }

    const estimatedCost = estimateCost(model, inputTokens, 1000);

    // Check cost limit
    if (estimatedCost > this.config.maxCostPerRequest) {
      const message = `Request blocked: Estimated cost $${estimatedCost.toFixed(4)} exceeds maximum $${this.config.maxCostPerRequest.toFixed(2)}`;
      this.logRequest(model, inputTokens, 0, estimatedCost, true, 100, message, textToAnalyze);
      return {
        success: false,
        blocked: true,
        wasteScore: 100,
        reason: message,
        estimatedCost,
      };
    }

    // Detect waste
    const wasteResult = this.wasteDetector.detectWaste(model, textToAnalyze, estimatedCost, context);
    
    if (wasteResult.isWasteful && wasteResult.wasteScore >= this.config.wasteThreshold) {
      if (this.config.blockMode && !overrideBlock) {
        const message = `Blocked request: ${wasteResult.reason}. Estimated waste: $${wasteResult.estimatedWaste.toFixed(4)}`;
        this.logRequest(model, inputTokens, 0, estimatedCost, true, wasteResult.wasteScore, wasteResult.reason, textToAnalyze);
        
        return {
          success: false,
          blocked: true,
          wasteScore: wasteResult.wasteScore,
          reason: message,
          suggestions: wasteResult.suggestions,
          estimatedCost: wasteResult.estimatedWaste,
        };
      } else {
        console.warn(`⚠️  Warning: ${wasteResult.reason}`);
      }
    }

    // Execute the API call
    try {
      const data = await apiCall();
      
      // Log successful request
      this.logRequest(model, inputTokens, 0, estimatedCost, false, wasteResult.wasteScore, '', textToAnalyze);
      
      return {
        success: true,
        data,
        wasteScore: wasteResult.wasteScore,
        estimatedCost,
      };
    } catch (error) {
      console.error('API call failed:', error);
      return {
        success: false,
        blocked: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Simple wrapper for OpenAI-style calls
   */
  async callOpenAI(
    apiCall: () => Promise<any>,
    model: string,
    messages: any[],
    overrideBlock?: boolean
  ): Promise<AIResponse> {
    return this.call(apiCall, { model, messages, overrideBlock });
  }

  /**
   * Simple wrapper for Anthropic-style calls
   */
  async callAnthropic(
    apiCall: () => Promise<any>,
    model: string,
    messages: any[],
    overrideBlock?: boolean
  ): Promise<AIResponse> {
    return this.call(apiCall, { model, messages, overrideBlock });
  }

  private logRequest(
    model: string,
    inputTokens: number,
    outputTokens: number,
    estimatedCost: number,
    wasBlocked: boolean,
    wasteScore: number,
    reason: string,
    prompt: string
  ): void {
    const promptHash = createHash('sha256').update(prompt).digest('hex');

    const entry: LogEntry = {
      timestamp: Date.now(),
      model,
      inputTokens,
      outputTokens,
      estimatedCost,
      wasBlocked,
      wasteScore,
      reason,
      promptHash,
    };

    this.logger.log(entry);

    if (wasBlocked) {
      console.log(`🚫 Blocked: ${reason} (waste score: ${wasteScore})`);
    }
  }

  /**
   * Get statistics
   */
  getStats(hours: number = 24) {
    return this.logger.getStats(hours);
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<{ blockMode: boolean; maxCostPerRequest: number; wasteThreshold: number }>) {
    this.config.updateConfig(updates);
  }
}
