/**
 * PricingConfig.ts - Real API Pricing Configuration
 * 
 * Maps token counts to actual costs for supported models
 * Used for real cost extraction from API responses
 */

export interface ModelPricing {
  inputPer1K: number;
  outputPer1K: number;
  provider: 'openai' | 'anthropic' | 'google' | 'cohere';
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CostCalculation {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  model: string;
  pricing: ModelPricing;
}

/**
 * Pricing Configuration - Singleton
 * Stores real pricing data for AI providers
 */
export class PricingConfig {
  private static instance: PricingConfig;
  private pricing: Record<string, ModelPricing>;

  private constructor() {
    this.pricing = {
      // OpenAI Models
      'gpt-4': { inputPer1K: 0.03, outputPer1K: 0.06, provider: 'openai' },
      'gpt-4-32k': { inputPer1K: 0.06, outputPer1K: 0.12, provider: 'openai' },
      'gpt-4-turbo': { inputPer1K: 0.01, outputPer1K: 0.03, provider: 'openai' },
      'gpt-4-turbo-preview': { inputPer1K: 0.01, outputPer1K: 0.03, provider: 'openai' },
      'gpt-4o': { inputPer1K: 0.005, outputPer1K: 0.015, provider: 'openai' },
      'gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006, provider: 'openai' },
      'gpt-3.5-turbo': { inputPer1K: 0.0005, outputPer1K: 0.0015, provider: 'openai' },
      'gpt-3.5-turbo-16k': { inputPer1K: 0.001, outputPer1K: 0.002, provider: 'openai' },
      
      // Anthropic Models
      'claude-3-opus': { inputPer1K: 0.015, outputPer1K: 0.075, provider: 'anthropic' },
      'claude-3-opus-20240229': { inputPer1K: 0.015, outputPer1K: 0.075, provider: 'anthropic' },
      'claude-3-sonnet': { inputPer1K: 0.003, outputPer1K: 0.015, provider: 'anthropic' },
      'claude-3-sonnet-20240229': { inputPer1K: 0.003, outputPer1K: 0.015, provider: 'anthropic' },
      'claude-3-haiku': { inputPer1K: 0.00025, outputPer1K: 0.00125, provider: 'anthropic' },
      'claude-3-haiku-20240307': { inputPer1K: 0.00025, outputPer1K: 0.00125, provider: 'anthropic' },
      'claude-2.1': { inputPer1K: 0.008, outputPer1K: 0.024, provider: 'anthropic' },
      'claude-2': { inputPer1K: 0.008, outputPer1K: 0.024, provider: 'anthropic' },
      'claude-instant-1.2': { inputPer1K: 0.0008, outputPer1K: 0.0024, provider: 'anthropic' },
      
      // Google Models
      'gemini-pro': { inputPer1K: 0.0005, outputPer1K: 0.0015, provider: 'google' },
      'gemini-pro-vision': { inputPer1K: 0.00025, outputPer1K: 0.0005, provider: 'google' },
      
      // Cohere Models
      'command': { inputPer1K: 0.0015, outputPer1K: 0.002, provider: 'cohere' },
      'command-light': { inputPer1K: 0.0003, outputPer1K: 0.0006, provider: 'cohere' },
      
      // Default fallback
      'default': { inputPer1K: 0.01, outputPer1K: 0.03, provider: 'openai' },
    };
  }

  static getInstance(): PricingConfig {
    if (!PricingConfig.instance) {
      PricingConfig.instance = new PricingConfig();
    }
    return PricingConfig.instance;
  }

  /**
   * Get pricing for a model
   */
  getPricing(model: string): ModelPricing {
    // Try exact match first
    if (this.pricing[model]) {
      return this.pricing[model];
    }

    // Try partial match (e.g., "gpt-4" matches "gpt-4-turbo")
    const modelLower = model.toLowerCase();
    const match = Object.keys(this.pricing).find(key => 
      modelLower.includes(key.toLowerCase()) || key.toLowerCase().includes(modelLower)
    );

    return match ? this.pricing[match] : this.pricing['default'];
  }

  /**
   * Calculate real cost from token usage
   */
  calculateCost(model: string, usage: TokenUsage): CostCalculation {
    const pricing = this.getPricing(model);
    
    const inputCost = (usage.prompt_tokens / 1000) * pricing.inputPer1K;
    const outputCost = (usage.completion_tokens / 1000) * pricing.outputPer1K;
    const totalCost = inputCost + outputCost;

    return {
      inputCost: Math.round(inputCost * 10000) / 10000,
      outputCost: Math.round(outputCost * 10000) / 10000,
      totalCost: Math.round(totalCost * 10000) / 10000,
      model,
      pricing,
    };
  }

  /**
   * Extract token usage from various API response formats
   */
  extractUsage(response: any): TokenUsage | null {
    try {
      // OpenAI format
      if (response?.usage) {
        return {
          prompt_tokens: response.usage.prompt_tokens || 0,
          completion_tokens: response.usage.completion_tokens || 0,
          total_tokens: response.usage.total_tokens || 0,
        };
      }

      // Anthropic format
      if (response?.usage?.input_tokens !== undefined) {
        return {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens || 0,
          total_tokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0),
        };
      }

      // Google format
      if (response?.usageMetadata?.totalTokenCount !== undefined) {
        return {
          prompt_tokens: response.usageMetadata.promptTokenCount || 0,
          completion_tokens: response.usageMetadata.candidatesTokenCount || 0,
          total_tokens: response.usageMetadata.totalTokenCount,
        };
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Update pricing for a model (for custom models)
   */
  updatePricing(model: string, pricing: ModelPricing): void {
    this.pricing[model] = pricing;
  }

  /**
   * Get all supported models
   */
  getSupportedModels(): string[] {
    return Object.keys(this.pricing).filter(m => m !== 'default');
  }
}

// Export singleton instance
export const pricingConfig = PricingConfig.getInstance();
