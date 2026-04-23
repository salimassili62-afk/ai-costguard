/**
 * Pricing configuration for AI models
 * Prices are per 1K tokens (input/output)
 */

export interface ModelPricing {
  inputPrice: number;  // Price per 1K input tokens
  outputPrice: number; // Price per 1K output tokens
}

export const PRICING_CONFIG: Record<string, ModelPricing> = {
  // OpenAI Models
  'gpt-4': { inputPrice: 0.03, outputPrice: 0.06 },
  'gpt-4-32k': { inputPrice: 0.06, outputPrice: 0.12 },
  'gpt-4-turbo': { inputPrice: 0.01, outputPrice: 0.03 },
  'gpt-4-turbo-preview': { inputPrice: 0.01, outputPrice: 0.03 },
  'gpt-4o': { inputPrice: 0.005, outputPrice: 0.015 },
  'gpt-4o-mini': { inputPrice: 0.00015, outputPrice: 0.0006 },
  'gpt-3.5-turbo': { inputPrice: 0.0005, outputPrice: 0.0015 },
  'gpt-3.5-turbo-16k': { inputPrice: 0.0015, outputPrice: 0.002 },
  'gpt-3.5-turbo-instruct': { inputPrice: 0.0015, outputPrice: 0.002 },
  
  // Anthropic Claude Models
  'claude-3-opus-20240229': { inputPrice: 0.015, outputPrice: 0.075 },
  'claude-3-sonnet-20240229': { inputPrice: 0.003, outputPrice: 0.015 },
  'claude-3-haiku-20240307': { inputPrice: 0.00025, outputPrice: 0.00125 },
  'claude-2.1': { inputPrice: 0.008, outputPrice: 0.024 },
  'claude-2': { inputPrice: 0.008, outputPrice: 0.024 },
  'claude-instant-1.2': { inputPrice: 0.0008, outputPrice: 0.0024 },
};

export function getModelPricing(model: string): ModelPricing | null {
  return PRICING_CONFIG[model] || null;
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;
  
  const inputCost = (inputTokens / 1000) * pricing.inputPrice;
  const outputCost = (outputTokens / 1000) * pricing.outputPrice;
  
  return inputCost + outputCost;
}
