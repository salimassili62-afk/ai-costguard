const STALE_PRICING_DAYS = 30;

/**
 * Last manual verification date for the built-in pricing registry.
 *
 * Provider pricing changes; use pricingOverrides/registerPricing for current
 * production pricing when provider pages differ from these built-ins.
 */
export const BUILTIN_PRICING_LAST_UPDATED = '2026-06-07';
// pricing last updated: 2026-06-07

/**
 * Pricing entry expressed in USD per 1,000 tokens.
 */
export interface ModelPricing {
  /** Model name or model family prefix. */
  model: string;
  /** USD price per 1,000 input tokens. */
  inputPer1kTokens: number;
  /** USD price per 1,000 output tokens. */
  outputPer1kTokens: number;
  /** Date this pricing entry was last checked, formatted as YYYY-MM-DD. */
  lastUpdated: string;
  /** Human-readable source for the pricing entry. */
  source: string;
}

const BUILTIN_PRICING: readonly ModelPricing[] = [
  {
    model: 'gpt-5.5',
    inputPer1kTokens: 0.005,
    outputPer1kTokens: 0.03,
    lastUpdated: '2026-06-07',
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    model: 'gpt-5.4',
    inputPer1kTokens: 0.0025,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-06-07',
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    model: 'gpt-5.4-mini',
    inputPer1kTokens: 0.00075,
    outputPer1kTokens: 0.0045,
    lastUpdated: '2026-06-07',
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    model: 'gpt-5.4-nano',
    inputPer1kTokens: 0.0002,
    outputPer1kTokens: 0.00125,
    lastUpdated: '2026-06-07',
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    model: 'gpt-4',
    inputPer1kTokens: 0.03,
    outputPer1kTokens: 0.06,
    lastUpdated: '2026-05-21',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-4o',
    inputPer1kTokens: 0.005,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-05-21',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-4o-mini',
    inputPer1kTokens: 0.00015,
    outputPer1kTokens: 0.0006,
    lastUpdated: '2026-05-21',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-3.5-turbo',
    inputPer1kTokens: 0.0005,
    outputPer1kTokens: 0.0015,
    lastUpdated: '2026-05-21',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'claude-opus-4.8',
    inputPer1kTokens: 0.005,
    outputPer1kTokens: 0.025,
    lastUpdated: '2026-06-07',
    source: 'https://claude.com/platform/api',
  },
  {
    model: 'claude-sonnet-4.6',
    inputPer1kTokens: 0.003,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-06-07',
    source: 'https://claude.com/platform/api',
  },
  {
    model: 'claude-haiku-4.5',
    inputPer1kTokens: 0.001,
    outputPer1kTokens: 0.005,
    lastUpdated: '2026-06-07',
    source: 'https://claude.com/platform/api',
  },
  {
    model: 'claude-3-opus',
    inputPer1kTokens: 0.015,
    outputPer1kTokens: 0.075,
    lastUpdated: '2026-05-21',
    source: 'https://www.anthropic.com/pricing',
  },
  {
    model: 'claude-3-sonnet',
    inputPer1kTokens: 0.003,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-05-21',
    source: 'https://www.anthropic.com/pricing',
  },
  {
    model: 'claude-3-haiku',
    inputPer1kTokens: 0.00025,
    outputPer1kTokens: 0.00125,
    lastUpdated: '2026-05-21',
    source: 'https://www.anthropic.com/pricing',
  },
];

const runtimePricing = new Map<string, ModelPricing>();
const staleWarnings = new Set<string>();

/**
 * Returns pricing for a model from overrides, runtime entries, or built-in entries.
 */
export function getPricing(model: string, overrides: readonly ModelPricing[] = []): ModelPricing | undefined {
  const normalizedModel = normalizeModel(model);

  warnIfAnyStale(overrides);
  warnIfAnyStale(runtimePricing.values());
  warnIfAnyStale(BUILTIN_PRICING);

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

/**
 * Registers or replaces runtime pricing entries by model name.
 */
export function registerPricing(entries: readonly ModelPricing[]): void {
  warnIfAnyStale(entries);

  for (const entry of entries) {
    runtimePricing.set(normalizeModel(entry.model), entry);
  }
}

/**
 * Lists built-in and runtime pricing entries, deduplicated by normalized model name.
 */
export function listPricing(): ModelPricing[] {
  const merged = new Map<string, ModelPricing>();

  for (const entry of BUILTIN_PRICING) {
    merged.set(normalizeModel(entry.model), entry);
  }

  for (const entry of runtimePricing.values()) {
    merged.set(normalizeModel(entry.model), entry);
  }

  const entries = Array.from(merged.values());
  warnIfAnyStale(entries);

  return entries;
}

function findExact(model: string, entries: readonly ModelPricing[]): ModelPricing | undefined {
  return entries.find((entry) => normalizeModel(entry.model) === model);
}

function findFuzzy(model: string, entries: readonly ModelPricing[]): ModelPricing | undefined {
  const sortedEntries = [...entries].sort((a, b) => b.model.length - a.model.length);

  return sortedEntries.find((entry) => {
    const entryModel = normalizeModel(entry.model);
    return model.startsWith(`${entryModel}-`) || model.startsWith(`${entryModel}:`);
  });
}

function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

function warnIfAnyStale(entries: Iterable<ModelPricing>): void {
  for (const entry of entries) {
    warnIfStale(entry);
  }
}

function warnIfStale(entry: ModelPricing): void {
  const lastUpdatedMs = Date.parse(`${entry.lastUpdated}T00:00:00.000Z`);
  if (!Number.isFinite(lastUpdatedMs)) return;

  const ageDays = (Date.now() - lastUpdatedMs) / 86_400_000;
  const warningKey = `${normalizeModel(entry.model)}:${entry.lastUpdated}`;

  if (ageDays > STALE_PRICING_DAYS && !staleWarnings.has(warningKey)) {
    staleWarnings.add(warningKey);
    console.warn(
      `[AI CostGuard] Pricing for "${entry.model}" is older than ${STALE_PRICING_DAYS} days. ` +
        `Last checked ${entry.lastUpdated}; verify ${entry.source}.`
    );
  }
}
