import { CostEstimate } from './types';

type Price = { inUsdPer1k: number; outUsdPer1k: number };

const MODEL_PRICES: Record<string, Price> = {
  'gpt-4o': { inUsdPer1k: 0.005, outUsdPer1k: 0.015 },
  'gpt-4o-mini': { inUsdPer1k: 0.00015, outUsdPer1k: 0.0006 },
  'gpt-4.1-mini': { inUsdPer1k: 0.0008, outUsdPer1k: 0.0032 },
};

const FALLBACK_PRICE: Price = { inUsdPer1k: 0.002, outUsdPer1k: 0.008 };
const CHARS_PER_TOKEN = 4;

export function estimateCost(model: string, prompt: string, maxOutputTokens = 512): CostEstimate {
  const inputTokens = Math.max(1, Math.ceil(prompt.length / CHARS_PER_TOKEN));
  const outputTokens = Math.max(1, maxOutputTokens);
  const price = MODEL_PRICES[model] ?? FALLBACK_PRICE;

  const estimatedUsd =
    (inputTokens / 1000) * price.inUsdPer1k + (outputTokens / 1000) * price.outUsdPer1k;

  return {
    inputTokens,
    outputTokens,
    estimatedUsd: Number(estimatedUsd.toFixed(6)),
  };
}
