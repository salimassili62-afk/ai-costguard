const STALE_PRICING_DAYS = 30;

/**
 * Days after which a pricing entry is reported as stale.
 *
 * Exported so the CLI, the runtime warning, and the documentation cannot drift apart.
 */
export const PRICING_STALE_AFTER_DAYS = STALE_PRICING_DAYS;

/**
 * Last manual verification date for the built-in pricing registry.
 *
 * This is a hand-maintained snapshot. AI CostGuard never fetches provider pricing, and nothing
 * in this file should be read as an authoritative or invoice-grade price list. Entries carry a
 * `source` URL so a mismatch can be checked by hand, and `pricingOverrides` /
 * `registerPricing` are the supported way to replace a price that is wrong for your contract.
 */
export const BUILTIN_PRICING_LAST_UPDATED = '2026-08-23';

/**
 * Human-readable caveat attached to the built-in registry.
 *
 * Kept in code so the CLI, the README, and the runtime warning cannot drift apart.
 */
export const PRICING_NOTICE =
  'Built-in pricing is a hand-maintained snapshot (' +
  `${BUILTIN_PRICING_LAST_UPDATED}), not a live price feed. ` +
  'Verify a model against its provider pricing page and override it when it differs.';

/**
 * Maximum number of built-in lookups cached by normalized model name.
 */
const BUILTIN_CACHE_LIMIT = 1024;

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

/**
 * Where a resolved pricing entry came from.
 */
export type PricingOrigin = 'override' | 'runtime' | 'builtin';

/**
 * How closely the resolved entry's model name matched the requested name.
 *
 * A `family-prefix` match means the requested name was not in the registry and was priced from the
 * nearest longer-or-equal family, so `o3-pro` is costed at the `o3` price and `gpt-5-ultra` at the
 * `gpt-5` price. The call is still costed, so the budget still moves, but the figure is an
 * assumption rather than a verified price and can be wrong in either direction.
 */
export type PricingMatch = 'exact' | 'family-prefix';

/**
 * Freshness metadata for the pricing entry resolved for a model.
 */
export interface PricingMeta {
  /** Pricing entry selected for the requested model. */
  pricing: ModelPricing;
  /** Where the selected entry came from. */
  origin: PricingOrigin;
  /**
   * Whether the entry matched the requested model name exactly or was inherited from a family
   * prefix. `pricing.model` differs from the requested name whenever this is `family-prefix`.
   */
  match: PricingMatch;
  /** Last manual verification date for the built-in registry. */
  registryLastUpdated: string;
  /** Age of the selected pricing entry in whole days. */
  ageDays: number;
  /** True when the selected pricing entry is older than the stale-pricing threshold. */
  stale: boolean;
  /** True when both prices are zero, which makes the entry useless as a safety input. */
  zeroPriced: boolean;
}

/**
 * Validates one pricing entry before it can influence a safety decision.
 *
 * Zero prices are accepted because genuinely free models exist, but a zero-priced entry is
 * reported through `getPricingMeta().zeroPriced` and warned about once, because it makes every
 * guarded request for that model cost nothing against the budget.
 */
export function validatePricing(entry: ModelPricing, field = 'pricing'): void {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError(`${field} must be an object`);
  }

  if (typeof entry.model !== 'string' || !entry.model.trim() || /\s/u.test(entry.model)) {
    throw new TypeError(`${field}.model must be a non-empty model identifier without whitespace`);
  }

  validatePrice(entry.inputPer1kTokens, `${field}.inputPer1kTokens`);
  validatePrice(entry.outputPer1kTokens, `${field}.outputPer1kTokens`);

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(entry.lastUpdated) || !isValidDate(entry.lastUpdated)) {
    throw new TypeError(`${field}.lastUpdated must be a valid YYYY-MM-DD date`);
  }

  if (typeof entry.source !== 'string' || !entry.source.trim()) {
    throw new TypeError(`${field}.source must be a non-empty string`);
  }
}

const BUILTIN_PRICING: readonly ModelPricing[] = [
  {
    model: 'gpt-4',
    inputPer1kTokens: 0.03,
    outputPer1kTokens: 0.06,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-4o',
    inputPer1kTokens: 0.005,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-4o-mini',
    inputPer1kTokens: 0.00015,
    outputPer1kTokens: 0.0006,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-4.1',
    inputPer1kTokens: 0.002,
    outputPer1kTokens: 0.008,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-4.1-mini',
    inputPer1kTokens: 0.0004,
    outputPer1kTokens: 0.0016,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-4.1-nano',
    inputPer1kTokens: 0.0001,
    outputPer1kTokens: 0.0004,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-3.5-turbo',
    inputPer1kTokens: 0.0005,
    outputPer1kTokens: 0.0015,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'o3',
    inputPer1kTokens: 0.002,
    outputPer1kTokens: 0.008,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'o4-mini',
    inputPer1kTokens: 0.0011,
    outputPer1kTokens: 0.0044,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-5',
    inputPer1kTokens: 0.00125,
    outputPer1kTokens: 0.01,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-5-mini',
    inputPer1kTokens: 0.00025,
    outputPer1kTokens: 0.002,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'gpt-5-nano',
    inputPer1kTokens: 0.00005,
    outputPer1kTokens: 0.0004,
    lastUpdated: '2026-08-23',
    source: 'https://openai.com/pricing',
  },
  {
    model: 'claude-opus-4-1',
    inputPer1kTokens: 0.015,
    outputPer1kTokens: 0.075,
    lastUpdated: '2026-08-23',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  {
    model: 'claude-sonnet-4-5',
    inputPer1kTokens: 0.003,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-08-23',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  {
    model: 'claude-haiku-4-5',
    inputPer1kTokens: 0.001,
    outputPer1kTokens: 0.005,
    lastUpdated: '2026-08-23',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  {
    model: 'claude-3-opus',
    inputPer1kTokens: 0.015,
    outputPer1kTokens: 0.075,
    lastUpdated: '2026-08-23',
    source: 'https://www.anthropic.com/pricing',
  },
  {
    model: 'claude-3-sonnet',
    inputPer1kTokens: 0.003,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-08-23',
    source: 'https://www.anthropic.com/pricing',
  },
  {
    model: 'claude-3-haiku',
    inputPer1kTokens: 0.00025,
    outputPer1kTokens: 0.00125,
    lastUpdated: '2026-08-23',
    source: 'https://www.anthropic.com/pricing',
  },
  {
    model: 'gemini-2.5-pro',
    inputPer1kTokens: 0.00125,
    outputPer1kTokens: 0.01,
    lastUpdated: '2026-08-23',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  {
    model: 'gemini-2.5-flash',
    inputPer1kTokens: 0.0003,
    outputPer1kTokens: 0.0025,
    lastUpdated: '2026-08-23',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  {
    model: 'gemini-2.0-flash',
    inputPer1kTokens: 0.0001,
    outputPer1kTokens: 0.0004,
    lastUpdated: '2026-08-23',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  {
    model: 'llama-3.3-70b',
    inputPer1kTokens: 0.00059,
    outputPer1kTokens: 0.00079,
    lastUpdated: '2026-08-23',
    source: 'https://api.groq.com/pricing',
  },
  {
    model: 'mistral-large',
    inputPer1kTokens: 0.002,
    outputPer1kTokens: 0.006,
    lastUpdated: '2026-08-23',
    source: 'https://mistral.ai/pricing',
  },
  {
    model: 'deepseek-chat',
    inputPer1kTokens: 0.00027,
    outputPer1kTokens: 0.0011,
    lastUpdated: '2026-08-23',
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
  },
  {
    model: 'grok-4',
    inputPer1kTokens: 0.003,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-08-23',
    source: 'https://docs.x.ai/docs/models',
  },
];

const runtimePricing = new Map<string, ModelPricing>();
const staleWarnings = new Set<string>();
const zeroPriceWarnings = new Set<string>();
const builtinCache = new Map<string, ModelPricing | undefined>();
const overrideCache = new WeakMap<readonly ModelPricing[], Map<string, ModelPricing | undefined>>();
const validatedOverrideArrays = new WeakSet<readonly ModelPricing[]>();
let runtimeSorted: ModelPricing[] = [];
let builtinNoticeEmitted = false;

const BUILTIN_BY_MODEL = new Map(BUILTIN_PRICING.map((entry) => [normalizeModel(entry.model), entry]));
const BUILTIN_SORTED = sortByModelLength(BUILTIN_PRICING);

// Disclose snapshot staleness at import time, not on the first lookup. See warnIfPricingIsStale.
warnIfPricingIsStale();

/**
 * Returns pricing for a model from overrides, runtime entries, or built-in entries.
 *
 * Unknown models return `undefined`, which the guard turns into a hard block by default.
 *
 * `overrides` must already be validated. `GuardCore` validates once in its constructor and then
 * passes the same array on every call, so this stays allocation-free on the guarded hot path.
 */
export function getPricing(model: string, overrides: readonly ModelPricing[] = []): ModelPricing | undefined {
  return resolvePricing(model, overrides)?.pricing;
}

/**
 * Returns freshness and provenance metadata for the pricing entry resolved for a model.
 */
export function getPricingMeta(model: string, overrides: readonly ModelPricing[] = []): PricingMeta | undefined {
  const resolved = resolvePricing(model, overrides);
  if (!resolved) return undefined;

  const { pricing, origin, match } = resolved;
  return {
    pricing,
    origin,
    match,
    registryLastUpdated: BUILTIN_PRICING_LAST_UPDATED,
    ageDays: getPricingAgeDays(pricing),
    stale: isPricingStale(pricing, STALE_PRICING_DAYS),
    zeroPriced: pricing.inputPer1kTokens === 0 && pricing.outputPer1kTokens === 0,
  };
}

/**
 * Reports whether the built-in registry snapshot is older than the staleness threshold.
 *
 * Exposed so CI, the CLI, and application health checks can surface registry age without
 * re-implementing the date arithmetic.
 */
export function isBuiltInPricingStale(staleAfterDays = STALE_PRICING_DAYS): boolean {
  return BUILTIN_PRICING.some((entry) => isPricingStale(entry, staleAfterDays));
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

  return Array.from(merged.values());
}

/**
 * Registers or replaces runtime pricing entries by model name.
 *
 * Runtime entries take precedence over the built-in registry for exact and prefix matches.
 * Entries are process-global, so register them once at startup rather than per request.
 */
export function registerPricing(entries: readonly ModelPricing[]): void {
  if (!Array.isArray(entries)) {
    throw new TypeError('pricing entries must be an array');
  }

  for (const [index, entry] of entries.entries()) {
    validatePricing(entry, `pricing[${index}]`);
  }

  warnIfAnyStale(entries);
  warnIfZeroPriced(entries);

  for (const entry of entries) {
    runtimePricing.set(normalizeModel(entry.model), entry);
  }

  runtimeSorted = sortByModelLength(Array.from(runtimePricing.values()));
  builtinCache.clear();
}

/**
 * Returns the built-in registry entries only.
 *
 * Used to suggest a sibling price in the UNKNOWN_MODEL block message. Runtime and override
 * entries are intentionally excluded: the message must only point at prices that ship with the
 * package, so a developer never copies a price another tenant registered at runtime.
 */
export function listBuiltInPricing(): readonly ModelPricing[] {
  return BUILTIN_PRICING;
}

/**
 * Validates pricing overrides once and emits the per-entry freshness warnings.
 *
 * Called from the `GuardCore` constructor and from `getPricing` on first use of a given array.
 * Validation is memoized per array instance, so a guard that reuses one `pricingOverrides` array
 * pays for it once instead of once per guarded request.
 *
 * Contract: treat a pricing array as immutable after it is first passed in. Mutating it later
 * invalidates the memoized validation and resolution results.
 */
export function preparePricingOverrides(overrides: readonly ModelPricing[] | undefined): void {
  if (!overrides || overrides.length === 0) return;
  if (validatedOverrideArrays.has(overrides)) return;

  for (const [index, entry] of overrides.entries()) {
    validatePricing(entry, `pricingOverrides[${index}]`);
  }

  warnIfAnyStale(overrides);
  warnIfZeroPriced(overrides);
  validatedOverrideArrays.add(overrides);
}

/**
 * Emits the one-time registry freshness notice.
 *
 * Called eagerly at module load rather than from the lookup path. The staleness of a shipped,
 * hand-maintained snapshot is a static fact: it is already true the moment the module is imported,
 * and it does not depend on which model a caller happens to ask about. Firing it lazily from
 * `resolvePricing` would make the notice land on whichever `getPricing` call happens to be first,
 * which is both harder to observe and impossible to test deterministically.
 *
 * Still exported so `aifw pricing --check-stale` and tests can ask the question explicitly.
 */
export function warnIfPricingIsStale(staleAfterDays = STALE_PRICING_DAYS): void {
  if (builtinNoticeEmitted) return;
  builtinNoticeEmitted = true;

  const stale = BUILTIN_PRICING.filter((entry) => isPricingStale(entry, staleAfterDays));
  if (stale.length === 0) return;

  console.warn(
    `[ai-costguard] ${stale.length} of ${BUILTIN_PRICING.length} built-in pricing entries are older than ` +
      `${staleAfterDays} days (last checked ${BUILTIN_PRICING_LAST_UPDATED}). ${PRICING_NOTICE}`
  );
}

interface ResolvedPricing {
  pricing: ModelPricing;
  origin: PricingOrigin;
  match: PricingMatch;
}

/**
 * Reports whether `entry` was selected by exact model name or inherited from a family prefix.
 *
 * Every resolver in this module already decides between the two cases; this only classifies the
 * entry it picked, so it cannot disagree with the lookup that produced it.
 */
function classifyMatch(requested: string, entry: ModelPricing): PricingMatch {
  return normalizeModel(entry.model) === requested ? 'exact' : 'family-prefix';
}

function resolvePricing(model: string, overrides: readonly ModelPricing[]): ResolvedPricing | undefined {
  if (typeof model !== 'string' || !model.trim()) return undefined;

  // Overrides are validated and their per-entry warnings are emitted once per array instance, so
  // this is a WeakSet lookup on the guarded hot path rather than an O(overrides) validate + warn
  // pass per request. GuardCore also calls preparePricingOverrides() from its constructor, which
  // makes this a no-op for guards entirely.
  preparePricingOverrides(overrides);

  const normalizedModel = normalizeModel(model);

  if (overrides.length > 0) {
    const entry = resolveOverride(normalizedModel, overrides);
    if (entry) return { pricing: entry, origin: 'override', match: classifyMatch(normalizedModel, entry) };
  }

  if (runtimePricing.size > 0) {
    const exact = runtimePricing.get(normalizedModel);
    if (exact) return { pricing: exact, origin: 'runtime', match: 'exact' };
    const fuzzy = findEntry(normalizedModel, runtimeSorted);
    if (fuzzy) return { pricing: fuzzy, origin: 'runtime', match: classifyMatch(normalizedModel, fuzzy) };
  }

  const builtin = resolveBuiltin(normalizedModel);
  return builtin
    ? { pricing: builtin, origin: 'builtin', match: classifyMatch(normalizedModel, builtin) }
    : undefined;
}

function resolveOverride(normalizedModel: string, overrides: readonly ModelPricing[]): ModelPricing | undefined {
  // The same array instance is reused for every request of a given guard, so its resolution
  // results are memoized instead of rescanned per call. WeakMap has no size, which is fine: the
  // cache entry is released with the array, and per-array growth is bounded by BUILTIN_CACHE_LIMIT.
  const cached = overrideCache.get(overrides);
  if (cached?.has(normalizedModel)) return cached.get(normalizedModel);

  const resolved = findEntry(normalizedModel, overrides);

  if (!cached) {
    const fresh = new Map<string, ModelPricing | undefined>();
    fresh.set(normalizedModel, resolved);
    overrideCache.set(overrides, fresh);
  } else {
    if (cached.size >= BUILTIN_CACHE_LIMIT) cached.clear();
    cached.set(normalizedModel, resolved);
  }

  return resolved;
}

function resolveBuiltin(normalizedModel: string): ModelPricing | undefined {
  const cached = builtinCache.get(normalizedModel);
  if (cached !== undefined || builtinCache.has(normalizedModel)) return cached;

  let resolved = BUILTIN_BY_MODEL.get(normalizedModel);
  if (!resolved) {
    const prefixes: string[] = [];
    for (const entry of BUILTIN_SORTED) {
      const entryModel = normalizeModel(entry.model);
      if (normalizedModel.startsWith(`${entryModel}-`) || normalizedModel.startsWith(`${entryModel}:`)) {
        prefixes.push(entryModel);
      }
    }

    // Longest matching family prefix wins, so gpt-4.1-mini never falls back to gpt-4.
    prefixes.sort((left, right) => right.length - left.length);
    resolved = prefixes.length > 0 ? BUILTIN_BY_MODEL.get(prefixes[0]!) : undefined;
  }

  if (builtinCache.size >= BUILTIN_CACHE_LIMIT) builtinCache.clear();
  builtinCache.set(normalizedModel, resolved);
  return resolved;
}

function findEntry(model: string, entries: readonly ModelPricing[]): ModelPricing | undefined {
  for (const entry of entries) {
    if (normalizeModel(entry.model) === model) return entry;
  }

  let best: ModelPricing | undefined;
  let bestLength = -1;
  for (const entry of entries) {
    const entryModel = normalizeModel(entry.model);
    if (!model.startsWith(`${entryModel}-`) && !model.startsWith(`${entryModel}:`)) continue;
    if (entryModel.length <= bestLength) continue;
    best = entry;
    bestLength = entryModel.length;
  }

  return best;
}

function sortByModelLength(entries: readonly ModelPricing[]): ModelPricing[] {
  return [...entries].sort((left, right) => right.model.length - left.model.length);
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
  const warningKey = `${normalizeModel(entry.model)}:${entry.lastUpdated}`;

  if (isPricingStale(entry, STALE_PRICING_DAYS) && !staleWarnings.has(warningKey)) {
    staleWarnings.add(warningKey);
    console.warn(
      `[ai-costguard] Pricing for "${entry.model}" is older than ${STALE_PRICING_DAYS} days. ` +
        `Last checked ${entry.lastUpdated}; verify ${entry.source}.`
    );
  }
}

function warnIfZeroPriced(entries: Iterable<ModelPricing>): void {
  for (const entry of entries) {
    if (entry.inputPer1kTokens !== 0 || entry.outputPer1kTokens !== 0) continue;

    const warningKey = normalizeModel(entry.model);
    if (zeroPriceWarnings.has(warningKey)) continue;

    zeroPriceWarnings.add(warningKey);
    console.warn(
      `[ai-costguard] Pricing for "${entry.model}" is 0/0 per 1k tokens, so every guarded request for it ` +
        'reserves $0 against the budget. Set real prices if this entry is a placeholder.'
    );
  }
}

function validatePrice(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite non-negative number`);
  }
}

function isValidDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getPricingAgeDays(entry: ModelPricing): number {
  const lastUpdatedMs = Date.parse(`${entry.lastUpdated}T00:00:00.000Z`);
  if (!Number.isFinite(lastUpdatedMs)) return Number.POSITIVE_INFINITY;

  return Math.max(0, Math.floor((Date.now() - lastUpdatedMs) / 86_400_000));
}

function isPricingStale(entry: ModelPricing, staleAfterDays: number): boolean {
  return getPricingAgeDays(entry) > staleAfterDays;
}
