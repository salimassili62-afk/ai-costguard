/**
 * Versioned pricing registry for AI providers.
 * Prices are per 1K tokens unless a unit field says otherwise.
 */

export type PricingProvider = 'openai' | 'anthropic' | 'google' | 'cohere' | 'openrouter' | 'custom';

export interface ModelPricing {
  inputPrice: number;
  outputPrice: number;
  provider?: PricingProvider;
  registryVersion?: string;
  aliases?: string[];
  cachedInputPrice?: number;
  reasoningOutputPrice?: number;
  audioInputPrice?: number;
  audioOutputPrice?: number;
  imageUnitPrice?: number;
}

export interface DetailedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
  imageUnits?: number;
}

export interface RegisteredPricing extends ModelPricing {
  model: string;
  provider: PricingProvider;
  registryVersion: string;
  aliases: string[];
}

const REGISTRY_VERSION = '2026-04-30';

const registry = new Map<string, RegisteredPricing>();
const aliases = new Map<string, string>();

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // OpenAI Models
  'gpt-4': { inputPrice: 0.03, outputPrice: 0.06, provider: 'openai' },
  'gpt-4-32k': { inputPrice: 0.06, outputPrice: 0.12, provider: 'openai' },
  'gpt-4-turbo': { inputPrice: 0.01, outputPrice: 0.03, provider: 'openai' },
  'gpt-4-turbo-preview': { inputPrice: 0.01, outputPrice: 0.03, provider: 'openai' },
  'gpt-4o': { inputPrice: 0.005, outputPrice: 0.015, provider: 'openai' },
  'gpt-4o-2024-05-13': { inputPrice: 0.005, outputPrice: 0.015, provider: 'openai', aliases: ['openai/gpt-4o'] },
  'gpt-4o-mini': { inputPrice: 0.00015, outputPrice: 0.0006, provider: 'openai' },
  'gpt-4o-mini-2024-07-18': {
    inputPrice: 0.00015,
    outputPrice: 0.0006,
    provider: 'openai',
    aliases: ['openai/gpt-4o-mini'],
  },
  'gpt-3.5-turbo': { inputPrice: 0.0005, outputPrice: 0.0015, provider: 'openai' },
  'gpt-3.5-turbo-0125': { inputPrice: 0.0005, outputPrice: 0.0015, provider: 'openai' },
  'gpt-3.5-turbo-16k': { inputPrice: 0.0015, outputPrice: 0.002, provider: 'openai' },
  'gpt-3.5-turbo-instruct': { inputPrice: 0.0015, outputPrice: 0.002, provider: 'openai' },

  // Anthropic Claude Models
  'claude-3-opus': { inputPrice: 0.015, outputPrice: 0.075, provider: 'anthropic' },
  'claude-3-opus-20240229': { inputPrice: 0.015, outputPrice: 0.075, provider: 'anthropic' },
  'claude-3-sonnet': { inputPrice: 0.003, outputPrice: 0.015, provider: 'anthropic' },
  'claude-3-sonnet-20240229': { inputPrice: 0.003, outputPrice: 0.015, provider: 'anthropic' },
  'claude-3-haiku': { inputPrice: 0.00025, outputPrice: 0.00125, provider: 'anthropic' },
  'claude-3-haiku-20240307': { inputPrice: 0.00025, outputPrice: 0.00125, provider: 'anthropic' },
  'claude-3-5-sonnet-20241022': { inputPrice: 0.003, outputPrice: 0.015, provider: 'anthropic' },
  'claude-3-5-haiku-20241022': { inputPrice: 0.0008, outputPrice: 0.004, provider: 'anthropic' },
  'claude-2.1': { inputPrice: 0.008, outputPrice: 0.024, provider: 'anthropic' },
  'claude-2': { inputPrice: 0.008, outputPrice: 0.024, provider: 'anthropic' },
  'claude-instant-1.2': { inputPrice: 0.0008, outputPrice: 0.0024, provider: 'anthropic' },

  // Google Gemini aliases and OpenRouter-friendly names.
  'gemini-pro': { inputPrice: 0.0005, outputPrice: 0.0015, provider: 'google', aliases: ['google/gemini-pro'] },
  'gemini-pro-vision': {
    inputPrice: 0.00025,
    outputPrice: 0.0005,
    provider: 'google',
    aliases: ['google/gemini-pro-vision'],
  },
};

function normalize(model: string): string {
  return model.trim().toLowerCase();
}

function registerDefaults(): void {
  for (const [model, pricing] of Object.entries(DEFAULT_PRICING)) {
    registerPricingModel(model, pricing);
  }
}

export function registerPricingModel(model: string, pricing: ModelPricing): RegisteredPricing {
  const normalized = normalize(model);
  const registered: RegisteredPricing = {
    ...pricing,
    model,
    provider: pricing.provider || 'custom',
    registryVersion: pricing.registryVersion || REGISTRY_VERSION,
    aliases: pricing.aliases || [],
  };

  registry.set(normalized, registered);
  aliases.set(normalized, normalized);
  for (const alias of registered.aliases) {
    aliases.set(normalize(alias), normalized);
  }

  return registered;
}

export function getModelPricing(model: string): RegisteredPricing | null {
  const normalized = normalize(model);
  const aliasTarget = aliases.get(normalized);
  if (aliasTarget && registry.has(aliasTarget)) {
    return registry.get(aliasTarget)!;
  }

  if (registry.has(normalized)) {
    return registry.get(normalized)!;
  }

  const partialMatch = Array.from(registry.keys()).find((key) => normalized.includes(key) || key.includes(normalized));

  return partialMatch ? registry.get(partialMatch)! : null;
}

export function listPricingModels(): RegisteredPricing[] {
  return Array.from(registry.values());
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  usage?: Partial<DetailedTokenUsage>
): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;

  const cachedInputTokens = usage?.cachedInputTokens || 0;
  const regularInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const reasoningTokens = usage?.reasoningTokens || 0;
  const regularOutputTokens = Math.max(0, outputTokens - reasoningTokens);

  const inputCost = (regularInputTokens / 1000) * pricing.inputPrice;
  const cachedInputCost = (cachedInputTokens / 1000) * (pricing.cachedInputPrice ?? pricing.inputPrice);
  const outputCost = (regularOutputTokens / 1000) * pricing.outputPrice;
  const reasoningCost = (reasoningTokens / 1000) * (pricing.reasoningOutputPrice ?? pricing.outputPrice);
  const audioInputCost = ((usage?.audioInputTokens || 0) / 1000) * (pricing.audioInputPrice || 0);
  const audioOutputCost = ((usage?.audioOutputTokens || 0) / 1000) * (pricing.audioOutputPrice || 0);
  const imageCost = (usage?.imageUnits || 0) * (pricing.imageUnitPrice || 0);

  return inputCost + cachedInputCost + outputCost + reasoningCost + audioInputCost + audioOutputCost + imageCost;
}

registerDefaults();
