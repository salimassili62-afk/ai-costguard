/**
 * SDK Interface - AI Execution Firewall
 * 
 * This file contains ONLY interface logic.
 * ALL detection happens in DetectionEngine (single source of truth).
 * 
 * Flow:
 *   User Input → SDK → DetectionEngine.analyze() → Result
 */

import { detectionEngine } from '../core/DetectionEngine';
import { Logger, LogEntry, logger } from '../logger';
import { estimateTokens, estimateMessagesTokens } from '../token-counter';
import { estimateCost, getModelPricing } from '../config';
import { ConfigManager } from '../config';
import { formatAlert } from '../utils/alert';
import { createHash, randomUUID } from 'crypto';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIRequestOptions {
  model: string;
  prompt?: string;
  messages?: ChatMessage[];
  context?: string;
  overrideBlock?: boolean;
}

export interface AIResponse<T = unknown> {
  success: boolean;
  blocked?: boolean;
  data?: T;
  dangerScore?: number;
  reason?: string;
  suggestions?: string[];
  estimatedCost?: number;
  savedAmount?: number;
  killSwitchTriggered?: boolean;
}

export class AIExecutionFirewall {
  private logger: Logger;
  private config: ConfigManager;

  constructor() {
    this.logger = new Logger();
    this.config = new ConfigManager();
  }

  async call<T = unknown>(
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
      logger.warn(`⚠️  Unknown model: ${model}, allowing request`);
      const data = await apiCall();
      return { success: true, data };
    }

    const estimatedCost = estimateCost(model, inputTokens, 1000);

    // SINGLE SOURCE OF TRUTH: Call DetectionEngine
    const detectionResult = detectionEngine.analyze({
      model,
      prompt: textToAnalyze,
      estimatedCost,
      context,
      trustMode: this.config.trustMode,
      override: overrideBlock
    });
    
    // Handle blocked request
    if (detectionResult.decision === 'block' && !overrideBlock) {
      const savedAmount = estimatedCost;
      // Map category to alert-compatible type (filter out 'safe'/'invalid')
      const alertCategory: 'loop' | 'duplicate' | 'fuzzy_duplicate' | 'context' | 'spike' | 'anomaly' = 
        detectionResult.category === 'safe' || detectionResult.category === 'invalid' 
          ? 'anomaly' 
          : detectionResult.category;
      const alert = formatAlert({
        severity: detectionResult.dangerScore >= 90 ? 'CRITICAL' : 'HIGH',
        category: alertCategory,
        reason: detectionResult.reason,
        estimatedLoss: savedAmount,
        suggestions: ['Use a cheaper model', 'Reduce token count', 'Split into smaller requests'],
      });
      if (alert) logger.log(alert);

      this.logRequest(model, inputTokens, 0, estimatedCost, true, detectionResult.dangerScore, detectionResult.reason, textToAnalyze);
      return {
        success: false,
        blocked: true,
        dangerScore: detectionResult.dangerScore,
        reason: detectionResult.reason,
        estimatedCost,
        savedAmount,
        killSwitchTriggered: detectionResult.dangerScore >= 90,
      };
    }

    // Handle warning case
    if (detectionResult.decision === 'warn') {
      logger.log(`⚠️  Warning: ${detectionResult.reason} (danger score: ${detectionResult.dangerScore})`);
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
        blocked: false,
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

  async callOpenAI<T = unknown>(
    apiCall: () => Promise<T>,
    model: string,
    messages: ChatMessage[],
    overrideBlock?: boolean
  ): Promise<AIResponse<T>> {
    return this.call(apiCall, { model, messages, overrideBlock });
  }

  async callAnthropic<T = unknown>(
    apiCall: () => Promise<T>,
    model: string,
    messages: ChatMessage[],
    overrideBlock?: boolean
  ): Promise<AIResponse<T>> {
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
    decisionTrace?: {
      category: string;
      severity: string;
      action: string;
      killSwitchTriggered: boolean;
    }
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
      logger.log(`🔴 BLOCKED by Firewall: ${reason} (danger score: ${dangerScore}) [trace: ${traceId}]`);
    }
  }

  getStats(hours: number = 24) {
    return this.logger.getStats(hours);
  }

  updateConfig(updates: Partial<{ trustMode: 'monitor' | 'warn' | 'block'; maxCostPerRequest: number; dangerThreshold: number }>) {
    this.config.updateConfig(updates);
  }
}
