/* MAINTENANCE: update BUILTIN_PRICING when model prices change.
   Check: https://openai.com/pricing and https://www.anthropic.com/pricing
   Update the lastUpdated field on every change. */

export interface ModelPricing {
  model: string;
  inputPer1kTokens: number;
  outputPer1kTokens: number;
  lastUpdated: string;
  source: string;
}

const BUILTIN_PRICING: ModelPricing[] = [
  {
    model: 'gpt-4',
    inputPer1kTokens: 0.03,
    outputPer1kTokens: 0.06,
    lastUpdated: '2026-05-21',
    source: 'https://openai.com/pricing'
  },
  {
    model: 'gpt-4o',
    inputPer1kTokens: 0.005,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-05-21',
    source: 'https://openai.com/pricing'
  },
  {
    model: 'gpt-4o-mini',
    inputPer1kTokens: 0.00015,
    outputPer1kTokens: 0.0006,
    lastUpdated: '2026-05-21',
    source: 'https://openai.com/pricing'
  },
  {
    model: 'gpt-3.5-turbo',
    inputPer1kTokens: 0.0005,
    outputPer1kTokens: 0.0015,
    lastUpdated: '2026-05-21',
    source: 'https://openai.com/pricing'
  },
  {
    model: 'claude-3-opus',
    inputPer1kTokens: 0.015,
    outputPer1kTokens: 0.075,
    lastUpdated: '2026-05-21',
    source: 'https://www.anthropic.com/pricing'
  },
  {
    model: 'claude-3-sonnet',
    inputPer1kTokens: 0.003,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-05-21',
    source: 'https://www.anthropic.com/pricing'
  },
  {
    model: 'claude-3-haiku',
    inputPer1kTokens: 0.00025,
    outputPer1kTokens: 0.00125,
    lastUpdated: '2026-05-21',
    source: 'https://www.anthropic.com/pricing'
  }
];

const runtimePricing = new Map<string, ModelPricing>();

export function getPricing(model: string, overrides: ModelPricing[] = []): ModelPricing | undefined {
  const normalizedModel = normalizeModel(model);
  const overrideExact = findExact(normalizedModel, overrides);
  if (overrideExact) return overrideExact;

  const overrideFuzzy = findFuzzy(normalizedModel, overrides);
  if (overrideFuzzy) return overrideFuzzy;

  const runtimeExact = runtimePricing.get(normalizedModel);
  if (runtimeExact) return runtimeExact;

  const runtimeFuzzy = findFuzzy(normalizedModel, Array.from(runtimePricing.values()));
  if (runtimeFuzzy) return runtimeFuzzy;

  const builtinExact = findExact(normalizedModel, BUILTIN_PRICING);
  if (builtinExact) return builtinExact;

  return findFuzzy(normalizedModel, BUILTIN_PRICING);
}

export function registerPricing(entries: ModelPricing[]): void {
  for (const entry of entries) {
    runtimePricing.set(normalizeModel(entry.model), entry);
  }
}

export function listPricing(): ModelPricing[] {
  const merged = new Map<string, ModelPricing>();

  for (const entry of BUILTIN_PRICING) {
    merged.set(normalizeModel(entry.model), entry);
  }

  for (const entry of runtimePricing.values()) {
    merged.set(normalizeModel(entry.model), entry);
  }

  return Array.from(merged.values());
}

function findExact(model: string, entries: ModelPricing[]): ModelPricing | undefined {
  return entries.find((entry) => normalizeModel(entry.model) === model);
}

function findFuzzy(model: string, entries: ModelPricing[]): ModelPricing | undefined {
  const sortedEntries = [...entries].sort((a, b) => b.model.length - a.model.length);

  return sortedEntries.find((entry) => {
    const entryModel = normalizeModel(entry.model);
    return model.includes(entryModel) || entryModel.includes(model);
  });
}

function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}
