import { WasteDetector } from '../waste-detection';
import { Logger, LogEntry } from '../logger';
import { estimateTokens, estimateMessagesTokens } from '../token-counter';
import { estimateCost, getModelPricing } from '../config';
import { ConfigManager } from '../config';
import { formatAlert } from '../utils/alert';
import { createHash, randomUUID } from 'crypto';

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
  dangerScore?: number;
  reason?: string;
  suggestions?: string[];
  estimatedCost?: number;
  savedAmount?: number;
  killSwitchTriggered?: boolean;
}

export class AIExecutionFirewall {
  private wasteDetector: WasteDetector;
  private logger: Logger;
  private config: ConfigManager;

  constructor() {
    this.wasteDetector = new WasteDetector();
    this.logger = new Logger();
    this.config = new ConfigManager();
  }

  async call<T = any>(
    apiCall: () => Promise<T>,
    options: AIRequestOptions
  ): Promise<AIResponse & { data?: T }> {
    const { model, prompt, messages, context, overrideBlock } = options;
    
    const textToAnalyze = prompt || JSON.stringify(messages || '');
    
    const inputTokens = messages 
      ? estimateMessagesTokens(messages, model)
      : estimateTokens(prompt || '', model);
    
    const pricing = getModelPricing(model);
    if (!pricing) {
      console.warn(`⚠️  Unknown model: ${model}, allowing request`);
      const data = await apiCall();
      return { success: true, data };
    }

    const estimatedCost = estimateCost(model, inputTokens, 1000);

    if (estimatedCost > this.config.maxCostPerRequest) {
      const savedAmount = estimatedCost;
      const alert = formatAlert({
        severity: 'CRITICAL',
        category: 'spike',
        reason: `Cost limit exceeded: Request cost $${estimatedCost.toFixed(4)} exceeds limit $${this.config.maxCostPerRequest.toFixed(2)}`,
        estimatedLoss: savedAmount,
        suggestions: ['Use a cheaper model', 'Reduce token count', 'Split into smaller requests'],
      });
      if (alert) console.log(alert);

      this.logRequest(model, inputTokens, 0, estimatedCost, true, 100, 'Cost limit protection', textToAnalyze);
      return {
        success: false,
        blocked: true,
        dangerScore: 100,
        reason: `Cost limit exceeded`,
        estimatedCost,
        savedAmount,
        killSwitchTriggered: true,
      };
    }

    const detectionResult = this.wasteDetector.detect(
      model,
      textToAnalyze,
      estimatedCost,
      context,
      this.config.trustMode,
      overrideBlock
    );
    
    if (detectionResult.isDangerous && detectionResult.dangerScore >= this.config.dangerThreshold) {
      if (detectionResult.action === 'block' && !overrideBlock) {
        const alert = formatAlert({
          severity: detectionResult.severity,
          category: detectionResult.category,
          reason: detectionResult.reason,
          estimatedLoss: detectionResult.estimatedLoss,
          suggestions: detectionResult.suggestions,
        });
        if (alert) console.log(alert);

        this.logRequest(model, inputTokens, 0, estimatedCost, true, detectionResult.dangerScore, detectionResult.reason, textToAnalyze);
        
        return {
          success: false,
          blocked: true,
          dangerScore: detectionResult.dangerScore,
          reason: detectionResult.reason,
          suggestions: detectionResult.suggestions,
          estimatedCost: detectionResult.estimatedLoss,
          killSwitchTriggered: detectionResult.killSwitchTriggered,
        };
      } else {
        console.log(`⚠️  Warning: ${detectionResult.reason} (danger score: ${detectionResult.dangerScore})`);
      }
    }

    try {
      const result = await apiCall();
      this.logRequest(model, inputTokens, 0, estimatedCost, false, detectionResult.dangerScore, '', textToAnalyze, {
        category: 'safe',
        severity: 'SAFE',
        action: 'allow',
        killSwitchTriggered: false,
      });
      
      return {
        success: true,
        data: result,
        dangerScore: detectionResult.dangerScore,
        estimatedCost,
        savedAmount: 0,
        killSwitchTriggered: false,
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

  async callOpenAI(
    apiCall: () => Promise<any>,
    model: string,
    messages: any[],
    overrideBlock?: boolean
  ): Promise<AIResponse> {
    return this.call(apiCall, { model, messages, overrideBlock });
  }

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
    dangerScore: number,
    reason: string,
    prompt: string,
    decisionTrace?: any
  ): void {
    const promptHash = createHash('sha256').update(prompt).digest('hex');
    const traceId = randomUUID();

    const entry: LogEntry = {
      timestamp: Date.now(),
      traceId,
      model,
      inputTokens,
      outputTokens,
      estimatedCost,
      wasBlocked,
      dangerScore,
      reason,
      promptHash,
      decisionTrace,
    };

    this.logger.log(entry);

    if (wasBlocked) {
      console.log(`🔴 BLOCKED by Firewall: ${reason} (danger score: ${dangerScore}) [trace: ${traceId}]`);
    }
  }

  getStats(hours: number = 24) {
    return this.logger.getStats(hours);
  }

  updateConfig(updates: Partial<{ trustMode: 'monitor' | 'warn' | 'block'; maxCostPerRequest: number; dangerThreshold: number }>) {
    this.config.updateConfig(updates);
  }
}
