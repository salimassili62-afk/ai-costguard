import { getPricing, listBuiltInPricing, preparePricingOverrides, validatePricing } from '../pricing/index.js';
import type { ModelPricing } from '../pricing/index.js';
import { sendCostGuardAlert } from './alerts.js';
import { appendGuardEventLog } from './event-log.js';
import { GuardEventEmitter } from './events.js';
import { cosineSimilarity, maxCosineSimilarity } from './similarity.js';
import { estimateRequestTokens } from './tokenizer.js';
import { describeScope } from './scope-fingerprint.js';
import type {
  CostGuardAlertPayload,
  CostGuardAlertsConfig,
  GuardConfig,
  GuardErrorCode,
  GuardEvent,
  GuardEventHandler,
  GuardEventName,
  GuardScope,
  GuardScopeState,
  GuardState,
  RequestContext,
} from './types.js';
import { notifyBlockWebhooks } from './webhooks.js';

const DEFAULT_BUDGET = 10;
const DEFAULT_MAX_HISTORY = 32;
const DEFAULT_HISTORY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LOOP_THRESHOLD = 0.85;
const DEFAULT_LOOP_MIN_REPEATS = 2;
const DEFAULT_LOOP_WINDOW_SIZE = 5;
const DEFAULT_RETRY_THRESHOLD = 2;
const DEFAULT_MAX_SCOPES = 10_000;

/**
 * SDK method paths guarded when `guardedMethods` is not configured.
 *
 * Every other method on a wrapped client is passed through untouched and is therefore
 * NOT cost-checked. See docs/COVERAGE.md for the full protected/not-protected table.
 */
export const DEFAULT_GUARDED_METHODS: readonly string[] = [
  'chat.completions.create',
  'completions.create',
  'responses.create',
  'messages.create',
] as const;

const ATTEMPT_TERMS = /\b(attempt|attempts|try|tries|pass|passes)\s*(?:#|no\.?|number)?\s*\d+\b/iu;

/**
 * Retry and failure vocabulary, matched one word at a time.
 *
 * Word-by-word rather than substring matching so "TransientError" and "Rerouted" are not hits: a
 * compound identifier that merely contains a retry word is not a retry.
 */
const RETRY_SIGNAL_WORD =
  /^(?:retry|retries|retrying|retried|rerun|reran|rerunning|reattempt|reattempted|redo|redone|repeat|repeated|repeating|again|try|tries|tried|attempt|attempts|attempted|error|errors|errored|fail|failed|failing|failure|failures|timeout|timed|throttled|exception|overloaded|429|500|502|503|504)$/iu;

/**
 * Leading tokens that mean the prompt is about a failure.
 *
 * A prompt that opens with one of these has the failure as its subject rather than mentioning it in
 * passing: "Error: 429 rate limit exceeded", "Failed to reach the vector store".
 */
const FAILURE_LEAD_WORD =
  /^(?:error|errors|errored|fail|failed|failing|failure|failures|timeout|timed|throttled|exception|overloaded|429|500|502|503|504)$/iu;

/**
 * Leading tokens that mean the prompt is a retry of a previous attempt.
 *
 * "again" and "repeat" are deliberately absent. They open ordinary continuation instructions far
 * more often than retries ("again summarize the second option"), and treating them as retry leads
 * blocked a session of perfectly benign prompts. They are still counted as retry vocabulary by the
 * dominance rule below, so "again after 429" is still a retry.
 */
const RETRY_LEAD_WORD =
  /^(?:retry|retries|retrying|retried|rerun|reran|rerunning|reattempt|reattempted|redo|redone|attempt|attempts|attempted)$/iu;

/**
 * Leading continuation words that only imply a retry when a failure is also present.
 */
const WEAK_RETRY_LEAD_WORD = /^(?:again|repeat|repeats|repeated|repeating|try|tries|tried)$/iu;

/**
 * Fraction of a prompt's words that must be retry or failure language before the prompt is treated
 * as an actual retry.
 *
 * Agent retry payloads look like "Error: 429 rate limit exceeded. Retrying." where nearly every word
 * is signal. Prose that merely discusses retries ("write tests for the retry wrapper, whose error
 * class is TransientError") is mostly ordinary words. Requiring the prompt to be *dominated* by the
 * vocabulary separates the two without weakening the verbatim-repeat detector, which is cosine
 * similarity's job rather than this heuristic's.
 */
const RETRY_SIGNAL_DOMINANCE = 0.3;

interface NormalizedBudget {
  maxUsd: number;
  thresholdUsd?: number;
}

interface NormalizedGuardConfig {
  budget: number;
  budgetThresholdUsd?: number;
  behaviorAnalysis: boolean;
  maxHistory: number;
  maxScopes: number;
  scopeIdleTtlMs?: number;
  historyTtlMs: number;
  maxSteps?: number;
  loopSimilarityThreshold: number;
  loopMinRepeats: number;
  loopWindowSize: number;
  retryThreshold: number;
  guardedMethods: string[];
  defaultOutputTokens?: number;
  unknownModelPolicy: 'block' | 'fallback';
  unknownModelPricing?: GuardConfig['unknownModelPricing'];
  pricingOverrides?: GuardConfig['pricingOverrides'];
  scope?: GuardScope;
  alerts?: CostGuardAlertsConfig;
  webhooks?: GuardConfig['webhooks'];
  eventLogPath?: string;
  eventLogPrompt: 'none' | 'preview';
  slackWebhook?: string;
  discordWebhook?: string;
}

/**
 * Result returned by the guard evaluator.
 */
export interface GuardCheckResult {
  /** Final guard decision. */
  decision: 'allow' | 'block';
  /** Request context that was evaluated. */
  context: RequestContext;
  /** Human-readable block reason, present when decision is "block". */
  reason?: string;
  /** Highest prompt similarity seen during loop detection. */
  similarity?: number;
}

/**
 * Extra structured metadata attached to GuardError.
 */
export interface GuardErrorMetadata {
  /** Stable machine-readable block reason. */
  code: GuardErrorCode;
  /** Human-readable block reason. */
  reason: string;
  /** Evaluated request context. */
  context: RequestContext;
  /** Current scope key for budget/history isolation. */
  scopeKey: string;
  /** Highest prompt similarity involved in a loop/retry decision. */
  similarity?: number;
  /** Model the block was evaluated for, or "unknown". */
  model: string;
  /** Estimated USD cost of the blocked request. Never provider spend. */
  estimatedCostUsd: number;
  /** Configured per-scope budget in USD. */
  budgetLimitUsd: number;
  /** Estimated USD already reserved in this scope before the decision. */
  reservedCostUsd: number;
  /** Estimated USD left in this scope. Never negative. */
  remainingUsd: number;
}

/**
 * Error thrown when a guarded request is blocked before reaching the AI provider.
 */
export class GuardError extends Error {
  /** Stable machine-readable block reason. */
  readonly code: GuardErrorCode;
  /** Request context that caused the block. */
  readonly context: RequestContext;
  /** Structured error metadata for API responses and logging. */
  readonly metadata: GuardErrorMetadata;

  /**
   * Creates a GuardError for a blocked request.
   */
  constructor(
    message: string,
    context: RequestContext = createEmptyContext(),
    code: GuardErrorCode = 'BUDGET_EXCEEDED',
    metadata: Partial<GuardErrorMetadata> = {}
  ) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
    this.context = context;
    this.metadata = {
      code,
      reason: message,
      context,
      scopeKey: context.scopeKey ?? 'default',
      model: context.model ?? 'unknown',
      estimatedCostUsd: safeMoney(context.estimatedCost),
      budgetLimitUsd: 0,
      reservedCostUsd: 0,
      remainingUsd: 0,
      ...metadata,
    };
  }

  toJSON(): GuardErrorMetadata {
    return this.metadata;
  }
}

/**
 * Shared synchronous evaluator used by the free proxy guard and middleware.
 */
export class GuardCore {
  private readonly config: NormalizedGuardConfig;
  private readonly state: GuardState;
  private readonly emitter = new GuardEventEmitter();
  private readonly approximateTokenWarnings = new Set<string>();
  private readonly thresholdAlertedScopes = new Set<string>();
  private readonly reconciledContexts = new WeakSet<RequestContext>();

  /**
   * Creates a process-local guard evaluator.
   */
  constructor(config: GuardConfig = {}, sharedState: GuardState = createGuardState()) {
    if (!config || typeof config !== 'object') {
      throw new GuardError('GuardCore config must be an object', undefined, 'CONFIG_INVALID');
    }
    const loopSimilarityThreshold =
      config.loopDetection?.similarityThreshold ?? config.loopSimilarityThreshold ?? DEFAULT_LOOP_THRESHOLD;
    const loopMinRepeats = config.loopDetection?.minHistorySize ?? config.loopMinRepeats ?? DEFAULT_LOOP_MIN_REPEATS;
    const loopWindowSize = config.loopDetection?.windowSize ?? DEFAULT_LOOP_WINDOW_SIZE;

    validateLoopConfig(loopSimilarityThreshold, loopMinRepeats, loopWindowSize);
    const budget = normalizeBudget(config.budget);
    const scope = normalizeConfigScope(config);

    if (config.maxHistory !== undefined && (!Number.isFinite(config.maxHistory) || config.maxHistory <= 0)) {
      throw new GuardError(
        'GuardCore maxHistory must be a finite number greater than 0',
        undefined,
        'CONFIG_INVALID'
      );
    }
    if (config.maxScopes !== undefined && (!Number.isFinite(config.maxScopes) || config.maxScopes < 1)) {
      throw configError('GuardCore maxScopes must be a finite number greater than 0');
    }
    if (config.scopeIdleTtlMs !== undefined && (!Number.isFinite(config.scopeIdleTtlMs) || config.scopeIdleTtlMs <= 0)) {
      throw configError('GuardCore scopeIdleTtlMs must be a finite number greater than 0');
    }
    if (config.historyTtlMs !== undefined && (!Number.isFinite(config.historyTtlMs) || config.historyTtlMs < 0)) {
      throw configError('GuardCore historyTtlMs must be a finite number greater than or equal to 0');
    }
    if (config.maxSteps !== undefined && (!Number.isFinite(config.maxSteps) || config.maxSteps < 1)) {
      throw configError('GuardCore maxSteps must be a finite number greater than or equal to 1');
    }
    if (config.retryThreshold !== undefined && (!Number.isFinite(config.retryThreshold) || config.retryThreshold < 1)) {
      throw configError('GuardCore retryThreshold must be a finite number greater than or equal to 1');
    }
    if (config.guardedMethods !== undefined &&
        (!Array.isArray(config.guardedMethods) || config.guardedMethods.some((method) => typeof method !== 'string' || !method.trim()))) {
      throw configError('GuardCore guardedMethods must be an array of non-empty strings');
    }
    if (config.unknownModelPolicy !== undefined && config.unknownModelPolicy !== 'block' && config.unknownModelPolicy !== 'fallback') {
      throw configError('GuardCore unknownModelPolicy must be "block" or "fallback"');
    }
    if (
      config.defaultOutputTokens !== undefined &&
      (!Number.isFinite(config.defaultOutputTokens) || config.defaultOutputTokens <= 0)
    ) {
      throw configError('GuardCore defaultOutputTokens must be a finite number greater than 0');
    }
    if (config.eventLogPrompt !== undefined && config.eventLogPrompt !== 'none' && config.eventLogPrompt !== 'preview') {
      throw configError('GuardCore eventLogPrompt must be "none" or "preview"');
    }

    validateConfiguredPricing(config.pricingOverrides, 'pricingOverrides');
    validateConfiguredPricing(
      config.unknownModelPolicy === 'fallback' && config.unknownModelPricing ? [config.unknownModelPricing] : [],
      'unknownModelPricing'
    );
    // Stale and 0/0 pricing entries in overrides are reported once per process here rather than on
    // every guarded request.
    preparePricingOverrides(config.pricingOverrides);

    this.config = {
      budget: budget.maxUsd,
      budgetThresholdUsd: budget.thresholdUsd,
      behaviorAnalysis: config.behaviorAnalysis ?? true,
      maxHistory: config.maxHistory ?? DEFAULT_MAX_HISTORY,
      maxScopes: Math.trunc(config.maxScopes ?? DEFAULT_MAX_SCOPES),
      scopeIdleTtlMs: config.scopeIdleTtlMs,
      historyTtlMs: Math.max(0, config.historyTtlMs ?? DEFAULT_HISTORY_TTL_MS),
      maxSteps: config.maxSteps,
      loopSimilarityThreshold,
      loopMinRepeats: Math.trunc(loopMinRepeats),
      loopWindowSize: Math.trunc(loopWindowSize),
      retryThreshold: Math.max(1, Math.trunc(config.retryThreshold ?? DEFAULT_RETRY_THRESHOLD)),
      guardedMethods: config.guardedMethods ?? [...DEFAULT_GUARDED_METHODS],
      defaultOutputTokens: config.defaultOutputTokens,
      unknownModelPolicy: config.unknownModelPolicy ?? 'block',
      unknownModelPricing: config.unknownModelPricing,
      pricingOverrides: config.pricingOverrides,
      scope,
      alerts: normalizeAlerts(config.alerts),
      eventLogPath: config.eventLogPath,
      eventLogPrompt: config.eventLogPrompt ?? 'none',
      slackWebhook: config.slackWebhook,
      discordWebhook: config.discordWebhook,
      webhooks: {
        ...config.webhooks,
        slack: config.webhooks?.slack ?? config.slackWebhook,
        discord: config.webhooks?.discord ?? config.discordWebhook,
      },
    };
    this.state = sharedState;
    hydrateScopeState(this.state);
    this.state.scopes ??= createScopeMap();
  }

  /**
   * Subscribes to guard events.
   */
  on(eventName: GuardEventName, handler: GuardEventHandler): () => void {
    return this.emitter.on(eventName, handler);
  }

  /**
   * Removes a guard event handler.
   */
  off(eventName: GuardEventName, handler: GuardEventHandler): void {
    this.emitter.off(eventName, handler);
  }

  /**
   * Returns the mutable process-local state used by this evaluator.
   */
  getState(): GuardState {
    return this.state;
  }

  /**
   * Returns true when a proxied method path should be evaluated.
   */
  shouldGuardMethod(methodPath: string): boolean {
    return this.config.guardedMethods.includes(methodPath);
  }

  /**
   * Extracts a normalized request context from OpenAI-like method arguments.
   */
  extractContext(args: readonly unknown[], method?: string): RequestContext {
    const params = args[0];
    const record = isRecord(params) ? params : {};
    const requestedModel = readString(record.model);
    if (!requestedModel) {
      throw new GuardError(
        'A model name is required before the request can be costed. Pass `model` in the request object.',
        undefined,
        'UNKNOWN_MODEL'
      );
    }
    const model = requestedModel;
    const scope = this.extractScope(record);
    const scopeKey = createScopeKey(scope);
    const tokenEstimate = estimateRequestTokens(record);
    const outputTokensPerCandidate = tokenEstimate.outputTokensPerCandidate ?? this.config.defaultOutputTokens;
    if (outputTokensPerCandidate === undefined) {
      throw new GuardError(
        'A finite output token limit is required for safe pre-call estimation. ' +
          'Pass one of max_tokens / max_completion_tokens / max_output_tokens in the request, ' +
          'or set guard({ defaultOutputTokens }) to reserve a fixed amount instead.',
        undefined,
        'OUTPUT_LIMIT_REQUIRED'
      );
    }
    // The estimator owns the costed surface, including both batch multipliers. Recomputing the
    // output total here is what previously let the two drift apart: the estimator multiplied by
    // promptCount for input tokens, and this method multiplied by candidateCount for output, so a
    // request that batched prompts *and* asked for n>1 completions was reserved at a fraction of
    // what the provider bills.
    const outputTokens =
      tokenEstimate.outputTokens ??
      outputTokensPerCandidate * tokenEstimate.candidateCount * tokenEstimate.promptCount;
    if (!Number.isFinite(outputTokens)) {
      throw new GuardError('Reserved output tokens for this request are not finite.', undefined, 'CONTEXT_INVALID');
    }
    if (tokenEstimate.approximate) {
      this.warnApproximateTokens(model, scopeKey);
    }
    const registryPricing = getPricing(model, this.config.pricingOverrides);
    const pricing = registryPricing ?? (this.config.unknownModelPolicy === 'fallback' ? this.config.unknownModelPricing : undefined);
    if (!pricing) {
      return {
        model,
        pricingKnown: false,
        pricing: undefined,
        tokens: tokenEstimate.inputTokens + outputTokens,
        inputTokens: tokenEstimate.inputTokens,
        approximateTokens: tokenEstimate.approximate,
        outputTokens,
      outputTokensSource: tokenEstimate.outputTokensPerCandidate === undefined ? 'default' : 'request',
      candidateCount: tokenEstimate.candidateCount,
      promptCount: tokenEstimate.promptCount,
      mediaTokens: tokenEstimate.mediaTokens,
        schemaTokens: tokenEstimate.schemaTokens,
        hasMediaInput: tokenEstimate.hasMediaInput,
        hasSchemaInput: tokenEstimate.hasSchemaInput,
        estimatedCost: 0,
        timestamp: Date.now(),
        prompt: tokenEstimate.prompt.slice(0, 4000),
        method,
        streaming: record.stream === true,
        scope,
        scopeKey,
      };
    }
    const inputPer1kTokens = pricing.inputPer1kTokens;
    const outputPer1kTokens = pricing.outputPer1kTokens;
    const estimatedCost =
      (tokenEstimate.inputTokens / 1000) * inputPer1kTokens + (outputTokens / 1000) * outputPer1kTokens;
    if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
      throw new GuardError(
        `Estimated cost for model "${model}" is not finite.`,
        undefined,
        'CONTEXT_INVALID'
      );
    }
    return {
      model,
      pricingKnown: true,
      pricing,
      tokens: tokenEstimate.inputTokens + outputTokens,
      inputTokens: tokenEstimate.inputTokens,
      approximateTokens: tokenEstimate.approximate,
      outputTokens,
      outputTokensSource: tokenEstimate.outputTokensPerCandidate === undefined ? 'default' : 'request',
        candidateCount: tokenEstimate.candidateCount,
        promptCount: tokenEstimate.promptCount,
      mediaTokens: tokenEstimate.mediaTokens,
      schemaTokens: tokenEstimate.schemaTokens,
      hasMediaInput: tokenEstimate.hasMediaInput,
      hasSchemaInput: tokenEstimate.hasSchemaInput,
      estimatedCost,
      timestamp: Date.now(),
      prompt: tokenEstimate.prompt.slice(0, 4000),
      method,
      streaming: record.stream === true,
      scope,
      scopeKey,
    };
  }

  /**
   * Evaluates one request and, when allowed, commits its estimated cost as a reservation.
   *
   * Concurrency contract
   * --------------------
   * This method is fully synchronous and never awaits. Everything between reading
   * `scope.reservedCost` for the budget test and writing it back for the reservation runs in one
   * uninterrupted turn of the event loop, with no user callback, `await`, or timer in between.
   * Two concurrent in-process callers therefore cannot both pass the budget test for the same
   * scope and then race to commit: the second caller observes the first caller's reservation.
   *
   * Scope of the guarantee:
   *
   * - Guaranteed: any number of concurrent `Promise.all` callers inside one Node.js process that
   *   share one guard, or guards that share one `GuardState`.
   * - Not guaranteed: separate processes, `worker_threads`, `cluster` workers, serverless
   *   isolates, or any other address space. Those need a shared store; see
   *   docs/SHARED-BUDGET.md.
   *
   * @throws GuardError for every policy block. A throw means the provider method was never called.
   */
  check(context: RequestContext): GuardCheckResult {
    normalizeRequestContext(context);
    const scope = this.getScopeState(context);
    const now = Date.now();
    this.pruneScope(scope, now);
    // Marked active for every request that reaches the scope, not only the ones that commit a
    // reservation. A session whose requests are all being blocked is still an active session: if
    // its idle clock only advanced on success, scopeIdleTtlMs would reclaim it mid-conversation
    // and hand the same user a fresh budget the moment they started being blocked again, which
    // turns a budget guard into an unlimited one.
    scope.lastRequestTime = now;
    this.recordAttempt(scope, context);

    // --- critical section: no user code, no await, no I/O below this line until commit ---
    if (context.pricingKnown === false) {
      return this.block('UNKNOWN_MODEL', unknownModelReason(context.model), context);
    }

    if (context.streaming) {
      return this.block(
        'STREAMING_UNSUPPORTED',
        'Streaming requests are blocked because final provider usage cannot be reconciled safely.',
        context
      );
    }

    const budgetDecision = this.checkBudget(scope, context);
    if (budgetDecision) return this.block('BUDGET_EXCEEDED', budgetDecision, context);

    if (this.config.behaviorAnalysis) {
      const stepDecision = this.checkMaxSteps(scope);
      if (stepDecision) return this.block('MAX_STEPS_EXCEEDED', stepDecision, context);

      const loop = this.findLoopSimilarity(scope, context.prompt);
      if (loop.count >= this.config.loopMinRepeats) {
        return this.block(
          'LOOP_DETECTED',
          `Loop detected: ${loop.count} recent prompts at similarity ${loop.max.toFixed(2)} or higher`,
          context,
          loop.max
        );
      }

      const retryDecision = this.checkRetryStorm(scope, context);
      if (retryDecision) return this.block('RETRY_STORM_DETECTED', retryDecision.reason, context, retryDecision.similarity);
    }

    // Commit the reservation in the same synchronous turn as the budget test above.
    this.commitReservation(scope, context);
    // --- end of critical section ---

    this.emit('cost', context);
    this.emit('allow', context);
    this.alertThresholdIfNeeded(scope, context);

    return { decision: 'allow', context };
  }

  /**
   * Writes the reservation for an allowed request.
   *
   * Kept as its own method so the budget test and this write are provably adjacent: nothing
   * between them can yield, so a concurrent caller cannot observe a stale `reservedCost`.
   */
  private commitReservation(scope: GuardScopeState, context: RequestContext): void {
    const now = Date.now();

    this.state.requestCount += 1;
    this.state.reservedCost = addMoney(this.state.reservedCost, context.estimatedCost);
    this.state.totalCost = this.state.reservedCost;
    this.state.lastRequestTime = now;

    scope.requestCount += 1;
    scope.reservedCost = addMoney(scope.reservedCost, context.estimatedCost);
    scope.totalCost = scope.reservedCost;
    scope.lastRequestTime = now;

    this.pushHistory(scope, 'recentPrompts', context.prompt);
    if (hasRetrySignal(context.prompt)) {
      this.pushHistory(scope, 'recentRetries', context.prompt);
    }
  }

  /**
   * Reconciles provider-reported usage from OpenAI/Anthropic-like response objects.
   *
   * Reconciliation is observability only. It never refunds a reservation, never rewrites an
   * earlier budget decision, and is applied at most once per request context.
   *
   * Documented fallbacks:
   *
   * - Both usage sides present: `actualCost` is computed from provider numbers, `usageStatus`
   *   is `reported`.
   * - One usage side present: the missing side falls back to the pre-call estimate, and
   *   `usageStatus` is `partial`. Treat the result as an upper bound.
   * - No recognizable usage fields: `actualCost` stays unset, `usageStatus` is `unavailable`, and
   *   the reservation stands as the only cost signal for this request.
   */
  recordActualUsage(context: RequestContext, response: unknown): void {
    if (this.reconciledContexts.has(context)) return;
    this.reconciledContexts.add(context);

    if (!context.pricing) {
      context.usageStatus = 'skipped';
      this.emit('usage', context);
      return;
    }

    const usage = extractUsage(response);
    if (!usage) {
      context.usageStatus = 'unavailable';
      this.emit('usage', context);
      return;
    }

    const inputTokens = usage.inputTokens ?? context.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? context.outputTokens ?? 0;
    const computed =
      (inputTokens / 1000) * context.pricing.inputPer1kTokens +
      (outputTokens / 1000) * context.pricing.outputPer1kTokens;

    if (!Number.isFinite(computed) || computed < 0) {
      context.usageStatus = 'unavailable';
      this.emit('usage', context);
      return;
    }

    // Rounded to the same micro-cent scale as every stored money field, so the per-request figure a
    // caller reads back is exactly the figure that was added to the running totals.
    const actualCost = roundMoney(computed);
    context.actualCost = actualCost;
    context.usageReported = true;
    context.usagePartial = usage.inputTokens === undefined || usage.outputTokens === undefined;
    context.usageStatus = context.usagePartial ? 'partial' : 'reported';

    this.state.actualCost = addMoney(this.state.actualCost, actualCost);
    const scope = this.findScopeState(context);
    if (scope) scope.actualCost = addMoney(scope.actualCost, actualCost);
    this.emit('usage', context);
  }

  private checkBudget(scope: GuardScopeState, context: RequestContext): string | undefined {
    // Both sides of the comparison are converted to exact integer micro-dollars before they are
    // compared. `projected` is already on that scale because `addMoney` rounds, but `this.budget` is
    // whatever the caller passed, and a budget derived by float arithmetic is not: a caller computing
    // `budget = 2 * 0.007509999999999999` gets 0.015019999999999998, while two accumulated charges
    // of 0.00751 sum to exactly 0.01502. Comparing those two floats directly blocks a call that lands
    // precisely on its budget, which is the opposite of the intent. Rounding the budget to the same
    // scale before comparing makes an exactly-at-budget charge allowed, matches the integer
    // micro-dollar rule the shared Redis path enforces, and means a float artefact can never decide a
    // block on its own.
    const projected = addMoney(scope.reservedCost, context.estimatedCost);
    if (toMicros(projected) <= toMicros(this.config.budget)) return undefined;
    return (
      `Budget exceeded for ${describeScope(context.scopeKey)}: ` +
      `reserved $${scope.reservedCost.toFixed(6)} + estimated $${context.estimatedCost.toFixed(6)} ` +
      `= $${projected.toFixed(6)} exceeds budget $${this.config.budget.toFixed(6)} ` +
      `(remaining $${Math.max(0, roundMoney(this.config.budget - scope.reservedCost)).toFixed(6)})`
    );
  }

  private checkMaxSteps(scope: GuardScopeState): string | undefined {
    if (this.config.maxSteps === undefined || scope.requestCount < this.config.maxSteps) return undefined;
    return `Max steps exceeded: ${scope.requestCount + 1} > ${this.config.maxSteps}`;
  }

  private findLoopSimilarity(scope: GuardScopeState, prompt: string): { max: number; count: number } {
    if (!prompt.trim()) return { max: 0, count: 0 };

    const history = (scope.recentPrompts ?? [])
      .slice(-this.config.loopWindowSize)
      .map((entry) => entry.prompt);
    const max = maxCosineSimilarity(prompt, history);
    const count = history.filter((candidate) => cosineSimilarity(prompt, candidate) >= this.config.loopSimilarityThreshold).length;
    return { max, count };
  }

  private checkRetryStorm(scope: GuardScopeState, context: RequestContext): { reason: string; similarity?: number } | undefined {
    if (!hasRetrySignal(context.prompt)) return undefined;

    const recentRetries = scope.recentRetries ?? [];
    const retrySimilarity = maxCosineSimilarity(
      context.prompt,
      recentRetries.map((entry) => entry.prompt)
    );

    if (retrySimilarity >= this.config.loopSimilarityThreshold) {
      return { reason: `Retry storm detected: retry similarity ${retrySimilarity.toFixed(2)}`, similarity: retrySimilarity };
    }

    if (recentRetries.length >= this.config.retryThreshold) {
      return { reason: `Retry storm detected: ${recentRetries.length + 1} retry/failure prompts` };
    }

    return undefined;
  }

  private recordAttempt(scope: GuardScopeState, context: RequestContext): void {
    this.state.attemptedCost = addMoney(this.state.attemptedCost, context.estimatedCost);
    scope.attemptedCost = addMoney(scope.attemptedCost, context.estimatedCost);
  }

  private pushHistory(scope: GuardScopeState, key: 'recentPrompts' | 'recentRetries', prompt: string): void {
    if (!prompt.trim()) return;

    const history = scope[key] ?? [];
    history.push({ prompt, timestamp: Date.now() });

    while (history.length > this.config.maxHistory) {
      history.shift();
    }

    scope[key] = history;
  }

  private block(
    code: GuardErrorCode,
    reason: string,
    context: RequestContext,
    similarity?: number
  ): GuardCheckResult {
    const scope = this.getScopeState(context);
    this.recordBlock(scope, context);
    this.emit('cost', context);
    this.emit('block', context, reason, code);

    void notifyBlockWebhooks(this.config.webhooks, { reason, context });
    void sendCostGuardAlert(this.config.alerts, this.createAlertPayload('blocked', codeToAlertReason(code), 'critical', context, {
      estimatedSavedUsd: context.estimatedCost,
      budgetUsedUsd: scope.reservedCost,
    }));

    throw new GuardError(reason, context, code, {
      similarity,
      scopeKey: context.scopeKey ?? 'default',
      model: context.model,
      estimatedCostUsd: safeMoney(context.estimatedCost),
      budgetLimitUsd: this.config.budget,
      reservedCostUsd: safeMoney(scope.reservedCost),
      remainingUsd: Math.max(0, roundMoney(this.config.budget - scope.reservedCost)),
    });
  }

  private recordBlock(scope: GuardScopeState | undefined, context: RequestContext): void {
    this.state.blockedCount += 1;
    this.state.blockedCost = addMoney(this.state.blockedCost, context.estimatedCost);
    if (!scope) return;

    scope.blockedCount += 1;
    scope.blockedCost = addMoney(scope.blockedCost, context.estimatedCost);
  }

  private emit(type: GuardEventName, context: RequestContext, reason?: string, code?: GuardErrorCode): void {
    const event: GuardEvent = {
      type,
      context,
      code,
      reason,
      state: this.hasEventConsumers() ? snapshotState(this.state) : EMPTY_STATE_SNAPSHOT,
    };

    if (this.config.eventLogPath) {
      appendGuardEventLog(this.config.eventLogPath, event, this.config.eventLogPrompt);
    }
    this.emitter.emit(event);
  }

  private hasEventConsumers(): boolean {
    return this.config.eventLogPath !== undefined || this.emitter.hasHandlers();
  }

  private getScopeState(context: RequestContext): GuardScopeState {
    const scopeKey = context.scopeKey ?? createScopeKey(context.scope);
    this.state.scopes ??= createScopeMap();
    const existing = readOwnScope(this.state.scopes, scopeKey);
    if (existing) {
      hydrateScopeState(existing);
      return existing;
    }

    if (Object.keys(this.state.scopes).length >= this.config.maxScopes) {
      // Only ever reached when a genuinely new scope arrives at a full map. This is off the hot
      // path, so the opt-in sweep below costs nothing for a healthy process.
      this.reclaimIdleScopes(Date.now());

      if (Object.keys(this.state.scopes).length >= this.config.maxScopes) {
        // No scope exists for this request, so only the process-wide aggregate is updated.
        // Failing closed here is deliberate: silently evicting a scope would hand a caller a fresh
        // budget for a project that already spent its allowance.
        this.state.attemptedCost = addMoney(this.state.attemptedCost, context.estimatedCost);
        this.recordBlock(undefined, context);
        this.emit('cost', context);

        const limitReached = new GuardError(
          `Maximum process-local scope count exceeded: ${this.config.maxScopes}. ` +
            'Raise maxScopes, shorten scope identifier lifetimes, or reset the process. ' +
            'Existing scope budgets are never evicted to make room.',
          context,
          'SCOPE_LIMIT_EXCEEDED',
          {
            scopeKey,
            model: context.model,
            estimatedCostUsd: safeMoney(context.estimatedCost),
            budgetLimitUsd: this.config.budget,
            reservedCostUsd: 0,
            remainingUsd: this.config.budget,
          }
        );
        this.emit('block', context, limitReached.message, 'SCOPE_LIMIT_EXCEEDED');
        throw limitReached;
      }
    }

    const fresh = createScopeState();
    fresh.reclaimable = isReclaimableScope(context.scope);
    defineOwnScope(this.state.scopes, scopeKey, fresh);
    return fresh;
  }

  /**
   * Drops idle session/run scopes so a long-lived process cannot wedge itself at `maxScopes`.
   *
   * Opt-in through `scopeIdleTtlMs`, and deliberately narrow:
   *
   * - Only scopes identified by `sessionId` or `runId` are eligible. A `projectId` or `userId`
   *   scope is a long-lived identity whose budget must survive for as long as the process does,
   *   and the implicit `default` scope holds the process-wide aggregate view.
   * - Only scopes idle for longer than the TTL are eligible, so an active session is never touched.
   * - The process-wide aggregate counters are never reset.
   *
   * Spend bound, stated precisely. Reclaiming a scope deletes that scope's accumulated spend, so
   * the next request under the reclaimed key starts a fresh per-scope budget. The process-wide
   * counters keep recording the money, but they are *reporting only*: `checkBudget` reads the
   * per-scope state and never consults the aggregate, so there is no process-wide spend cap to
   * backstop this. Two consequences follow, and both are properties of the caller's scope
   * identifiers rather than of the TTL:
   *
   * - A fixed population of scope identifiers that recycles among itself cannot spend more than
   *   `budget` per identifier per TTL window, because an identifier must be idle for the full TTL
   *   between reclamations. This is the case the TTL is designed for.
   * - A caller that continually introduces *new* scope identifiers can exceed `budget` in total
   *   without bound, because every newly arriving scope at a full map triggers another sweep and
   *   can reclaim up to `maxScopes` idle scopes. Each reclamation is worth up to one further
   *   `budget` of spend.
   *
   * The guard is therefore enforcing a per-scope budget, not a per-process one. Callers that need a
   * hard process-wide ceiling must either scope by `projectId`/`userId` (never reclaimed), or run
   * the shared-budget `GuardPro` path, where the total is held in Redis and reclamation cannot apply.
   */
  private reclaimIdleScopes(now: number): void {
    const ttl = this.config.scopeIdleTtlMs;
    const scopes = this.state.scopes;
    if (ttl === undefined || !scopes) return;

    const idleBefore = now - ttl;
    let reclaimed = 0;

    for (const [scopeKey, scope] of Object.entries(scopes)) {
      if (scope?.reclaimable !== true) continue;
      if (scope.lastRequestTime > idleBefore) continue;
      if (Reflect.deleteProperty(scopes, scopeKey)) {
        reclaimed += 1;
      }
    }

    if (reclaimed > 0) {
      this.state.reclaimedScopeCount = (this.state.reclaimedScopeCount ?? 0) + reclaimed;
    }
  }

  /**
   * Looks up an existing scope without creating one and without ever throwing.
   *
   * Post-call usage reconciliation runs after the provider has already been paid, so it must not be
   * able to fail: a throw here would surface to the caller as a rejected promise for a request the
   * provider already executed. When the scope is genuinely absent the aggregate total is still
   * updated and the per-scope total is simply left alone.
   */
  private findScopeState(context: RequestContext): GuardScopeState | undefined {
    const scopes = this.state.scopes;
    if (!scopes) return undefined;

    const scopeKey = context.scopeKey ?? createScopeKey(context.scope);
    const existing = readOwnScope(scopes, scopeKey);
    if (!existing) return undefined;

    hydrateScopeState(existing);
    return existing;
  }

  private pruneScope(scope: GuardScopeState, now: number): void {
    if (this.config.historyTtlMs === 0) return;
    const minTimestamp = now - this.config.historyTtlMs;
    scope.recentPrompts = (scope.recentPrompts ?? []).filter((entry) => entry.timestamp >= minTimestamp);
    scope.recentRetries = (scope.recentRetries ?? []).filter((entry) => entry.timestamp >= minTimestamp);
    scope.sessionExpiresAt = now + this.config.historyTtlMs;
  }

  private extractScope(record: Record<string, unknown>): GuardScope {
    return {
      projectId: readString(record.projectId ?? record.project_id) ?? this.config.scope?.projectId,
      userId: readString(record.userId ?? record.user_id) ?? this.config.scope?.userId,
      sessionId: readString(record.sessionId ?? record.session_id) ?? this.config.scope?.sessionId,
      runId: readString(record.runId ?? record.run_id) ?? this.config.scope?.runId,
    };
  }

  private warnApproximateTokens(model: string, scopeKey: string): void {
    const warningKey = `${model}:${scopeKey}`;
    if (this.approximateTokenWarnings.has(warningKey)) return;

    this.approximateTokenWarnings.add(warningKey);
    console.warn(
      `[ai-costguard] Using approximate token counting for model: ${model}. ` +
        'Register an exact tokenizer via registerTokenizer() for production use.'
    );
  }

  private alertThresholdIfNeeded(scope: GuardScopeState, context: RequestContext): void {
    const thresholdUsd = this.config.budgetThresholdUsd;
    if (thresholdUsd === undefined || scope.reservedCost < thresholdUsd) return;

    const scopeKey = context.scopeKey ?? createScopeKey(context.scope);
    if (this.thresholdAlertedScopes.has(scopeKey)) return;

    this.thresholdAlertedScopes.add(scopeKey);
    void sendCostGuardAlert(
      this.config.alerts,
      this.createAlertPayload('threshold', 'budget_threshold', 'warning', context, {
        budgetUsedUsd: scope.reservedCost,
      })
    );
  }

  private createAlertPayload(
    event: 'blocked' | 'threshold',
    reason: string,
    severity: 'info' | 'warning' | 'critical',
    context: RequestContext,
    money: { estimatedSavedUsd?: number; budgetUsedUsd?: number } = {}
  ): CostGuardAlertPayload {
    return {
      event,
      reason,
      severity,
      projectId: context.scope?.projectId,
      runId: context.scope?.runId ?? context.scope?.sessionId,
      model: context.model === 'unknown' ? undefined : context.model,
      provider: inferProvider(context.model),
      estimatedCostUsd: roundMoney(context.estimatedCost),
      estimatedSavedUsd:
        money.estimatedSavedUsd === undefined ? undefined : roundMoney(money.estimatedSavedUsd),
      budgetLimitUsd: roundMoney(this.config.budget),
      budgetUsedUsd: money.budgetUsedUsd === undefined ? undefined : roundMoney(money.budgetUsedUsd),
      timestamp: new Date().toISOString(),
      packageName: '@salimassili/ai-costguard',
    };
  }
}

/**
 * Creates an empty process-local guard state.
 */
export function createGuardState(): GuardState {
  return {
    ...createScopeState(),
    scopes: createScopeMap(),
  };
}

/**
 * Creates the scope map with no prototype.
 *
 * The map is keyed by `context.scopeKey`, which a caller supplies directly when it drives the guard
 * through `middleware()`. A null prototype makes it structurally impossible for a scope key to
 * resolve to a value inherited from `Object.prototype`.
 */
function createScopeMap(): Record<string, GuardScopeState> {
  return Object.create(null) as Record<string, GuardScopeState>;
}

/**
 * Reads a scope by key, ignoring anything inherited from the prototype chain.
 *
 * This is the second half of the guarantee `createScopeMap()` provides by default. A caller can
 * still hand `guard()` a `GuardState` whose `scopes` is an ordinary object literal, and keys such
 * as `__proto__`, `constructor`, or `toString` would otherwise resolve to real objects: the guard
 * would then read and write budget balances, loop history, and counters on `Object.prototype`,
 * corrupting every object in the process and pooling unrelated callers into one budget bucket.
 */
function readOwnScope(
  scopes: Record<string, GuardScopeState>,
  scopeKey: string
): GuardScopeState | undefined {
  return Object.hasOwn(scopes, scopeKey) ? scopes[scopeKey] : undefined;
}

/**
 * Stores a scope as an own enumerable data property.
 *
 * Plain assignment to a `__proto__` key runs the prototype setter instead of creating a property,
 * so the scope would never be found again and `maxScopes` would never count it. `defineProperty`
 * creates the own property the rest of this class reads.
 */
function defineOwnScope(
  scopes: Record<string, GuardScopeState>,
  scopeKey: string,
  scope: GuardScopeState
): void {
  Object.defineProperty(scopes, scopeKey, {
    value: scope,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function createScopeState(): GuardScopeState {
  return {
    requestCount: 0,
    reservedCost: 0,
    totalCost: 0,
    attemptedCost: 0,
    blockedCost: 0,
    actualCost: 0,
    lastRequestTime: 0,
    blockedCount: 0,
    recentPrompts: [],
    recentRetries: [],
    reclaimable: false,
  };
}

/**
 * True when a scope identity is short-lived enough to be reclaimed once it goes idle.
 *
 * Only `sessionId` and `runId` qualify. A `projectId` or `userId` scope is a durable identity
 * whose accumulated spend has to keep blocking, and the implicit default scope carries the
 * process-wide view.
 */
function isReclaimableScope(scope: GuardScope | undefined): boolean {
  if (!scope) return false;
  if (scope.projectId || scope.userId) return false;
  return Boolean(scope.sessionId || scope.runId);
}

const EMPTY_STATE_SNAPSHOT: Readonly<GuardState> = Object.freeze({
  ...createScopeState(),
  scopes: Object.freeze({}) as Record<string, GuardScopeState>,
});

/**
 * Copies the aggregate counters and the scope map so event listeners cannot mutate live state.
 *
 * Scope objects are shared on purpose: they are hot-path objects and copying every scope on
 * every event would be O(scopes) per guarded call.
 */
function snapshotState(state: GuardState): Readonly<GuardState> {
  return { ...state, scopes: { ...state.scopes } };
}

function safeMoney(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Returns a short, stable, non-reversible label for a scope key.
 *
 * `GuardError.metadata.scopeKey` still carries the raw key for the caller that threw it, which owns
 * those values already.
 */
function hydrateScopeState(state: GuardScopeState): void {
  state.requestCount ??= 0;
  state.reservedCost ??= state.totalCost ?? 0;
  state.totalCost ??= 0;
  state.attemptedCost ??= state.totalCost ?? 0;
  state.blockedCost ??= 0;
  state.actualCost ??= 0;
  state.lastRequestTime ??= 0;
  state.blockedCount ??= 0;
  state.recentPrompts ??= [];
  state.recentRetries ??= [];
  state.reclaimable ??= false;
}

function normalizeBudget(configBudget: GuardConfig['budget']): NormalizedBudget {
  if (configBudget === undefined) return { maxUsd: DEFAULT_BUDGET };

  if (typeof configBudget === 'number') {
    return { maxUsd: validateMoney(configBudget, 'budget') };
  }

  if (!isRecord(configBudget)) {
    throw configError('budget must be a non-negative number or { maxUsd } object');
  }

  const maxUsd = validateMoney(configBudget.maxUsd, 'budget.maxUsd');
  const thresholdUsd =
    configBudget.thresholdUsd === undefined
      ? normalizeThresholdPercent(configBudget.thresholdPercent, maxUsd)
      : validateMoney(configBudget.thresholdUsd, 'budget.thresholdUsd');

  if (thresholdUsd !== undefined && thresholdUsd > maxUsd) {
    throw configError('budget threshold must be less than or equal to budget.maxUsd');
  }

  return { maxUsd, thresholdUsd };
}

function normalizeThresholdPercent(value: unknown, maxUsd: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw configError('budget.thresholdPercent must be a number greater than 0 and less than or equal to 1');
  }
  return maxUsd * value;
}

function normalizeConfigScope(config: GuardConfig): GuardScope | undefined {
  const projectId = readString(config.scope?.projectId) ?? readString(config.projectId);
  const userId = readString(config.scope?.userId);
  const sessionId = readString(config.scope?.sessionId);
  const runId = readString(config.scope?.runId) ?? readString(config.runId);

  if (!projectId && !userId && !sessionId && !runId) return undefined;

  return {
    projectId,
    userId,
    sessionId,
    runId,
  };
}

function normalizeAlerts(alerts: GuardConfig['alerts']): CostGuardAlertsConfig | undefined {
  if (!alerts) return undefined;

  if (alerts.timeoutMs !== undefined && (!Number.isFinite(alerts.timeoutMs) || alerts.timeoutMs < 0)) {
    throw configError('alerts.timeoutMs must be a non-negative number');
  }

  if (alerts.format !== undefined && alerts.format !== 'json' && alerts.format !== 'slack') {
    throw configError('alerts.format must be "json" or "slack"');
  }

  for (const event of alerts.events ?? []) {
    if (event !== 'blocked' && event !== 'threshold') {
      throw configError('alerts.events can only include "blocked" or "threshold"');
    }
  }

  return {
    ...alerts,
    webhookUrl: readString(alerts.webhookUrl),
  };
}

function validateLoopConfig(similarityThreshold: number, minHistorySize: number, windowSize: number): void {
  if (!Number.isFinite(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) {
    throw configError('loopDetection.similarityThreshold must be between 0 and 1');
  }

  if (!Number.isFinite(minHistorySize) || minHistorySize < 1) {
    throw configError('loopDetection.minHistorySize must be at least 1');
  }

  if (!Number.isFinite(windowSize) || windowSize < 1) {
    throw configError('loopDetection.windowSize must be at least 1');
  }
}

function normalizeRequestContext(context: RequestContext): void {
  if (!context || typeof context !== 'object') {
    throw configError('Guard request context must be an object');
  }

  context.model = readString(context.model) ?? 'unknown';
  if (!Number.isFinite(context.tokens) || context.tokens < 0) {
    throw contextError('Guard request context tokens must be a finite non-negative number');
  }
  if (context.inputTokens !== undefined && (!Number.isFinite(context.inputTokens) || context.inputTokens < 0)) {
    throw contextError('Guard request context inputTokens must be a finite non-negative number');
  }
  if (context.outputTokens !== undefined && (!Number.isFinite(context.outputTokens) || context.outputTokens < 0)) {
    throw contextError('Guard request context outputTokens must be a finite non-negative number');
  }
  if (!Number.isFinite(context.estimatedCost) || context.estimatedCost < 0) {
    throw contextError('Guard request context estimatedCost must be a finite non-negative number');
  }
  if (context.actualCost !== undefined && (!Number.isFinite(context.actualCost) || context.actualCost < 0)) {
    throw contextError('Guard request context actualCost must be a finite non-negative number');
  }
  if (!Number.isFinite(context.timestamp)) {
    throw contextError('Guard request context timestamp must be finite');
  }
  if (typeof context.prompt !== 'string') {
    throw contextError('Guard request context prompt must be a string');
  }
  if (context.pricingKnown !== true && context.pricingKnown !== false) {
    throw contextError('Guard request context pricingKnown must be explicitly true or false');
  }
  if (context.pricingKnown && context.model === 'unknown') {
    throw contextError('Guard request context cannot mark an unknown model as priced');
  }
  if (context.pricing) {
    try {
      validatePricing(context.pricing, 'request pricing');
    } catch (error) {
      throw contextError(error instanceof Error ? error.message : 'Guard request pricing is invalid');
    }
  }

  context.scope = normalizeScope(context.scope);
  context.scopeKey = context.scopeKey ?? createScopeKey(context.scope);
  if (typeof context.scopeKey !== 'string' || context.scopeKey.length > 2048) {
    throw contextError('Guard request context scopeKey must be a string no longer than 2048 characters');
  }
}

function createEmptyContext(): RequestContext {
  return {
    model: 'unknown',
    pricingKnown: false,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    timestamp: Date.now(),
    prompt: '',
    scopeKey: 'default',
  };
}

function createScopeKey(scope: GuardScope | undefined): string {
  const normalized = normalizeScope(scope);
  if (!normalized) return 'default';
  return JSON.stringify([
    normalized.projectId ?? null,
    normalized.userId ?? null,
    normalized.sessionId ?? null,
    normalized.runId ?? null,
  ]);
}

function normalizeScopePart(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized && normalized.length > 256) {
    throw contextError('Guard scope identifiers must be no longer than 256 characters');
  }
  return normalized ? normalized : undefined;
}

function normalizeScope(scope: GuardScope | undefined): GuardScope | undefined {
  if (!scope) return undefined;
  const normalized = {
    projectId: normalizeScopePart(scope.projectId),
    userId: normalizeScopePart(scope.userId),
    sessionId: normalizeScopePart(scope.sessionId),
    runId: normalizeScopePart(scope.runId),
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

/**
 * Heuristic retry signal.
 *
 * A prompt counts toward retry-storm detection when it carries an explicit attempt counter, when it
 * *opens* with retry or failure language, or when that language dominates it.
 *
 * The previous rule accepted any prompt containing a retry word and a failure word *anywhere*, so a
 * session that happened to discuss retries three times was blocked with RETRY_STORM_DETECTED even
 * though nothing was being retried: three unrelated documentation questions about a retry wrapper
 * tripped the guard. Both new signals key on the retry being the *subject* of the prompt rather than
 * an aside in it, which is how an agent retry payload actually reads.
 *
 * Under-detecting here is the safe direction. A genuine storm is still caught, because repeated
 * attempts either match these signals or are near-identical, and near-identical prompts are what
 * `LOOP_DETECTED` catches by cosine similarity.
 */
function hasRetrySignal(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;

  // "attempt 2" is a retry marker by construction, wherever it appears.
  if (ATTEMPT_TERMS.test(trimmed)) return true;

  const words = trimmed.split(/\s+/u);
  const lead = stripSurroundingPunctuation(words[0]!);

  if (FAILURE_LEAD_WORD.test(lead) || RETRY_LEAD_WORD.test(lead)) return true;

  // A continuation lead only means a retry when the prompt also reports a failure, which keeps
  // "again summarize the second option" out of the retry history.
  if (WEAK_RETRY_LEAD_WORD.test(lead) && words.some((word) => FAILURE_LEAD_WORD.test(stripSurroundingPunctuation(word)))) {
    return true;
  }

  // "Please try again, the call failed" leads with a courtesy word instead.
  let signalWords = 0;
  for (const word of words) {
    if (RETRY_SIGNAL_WORD.test(stripSurroundingPunctuation(word))) signalWords += 1;
  }

  return signalWords / words.length >= RETRY_SIGNAL_DOMINANCE;
}

/** Removes leading and trailing punctuation so "Error:" and "failed." match the word patterns. */
function stripSurroundingPunctuation(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Builds the UNKNOWN_MODEL block message.
 *
 * Unknown pricing fails closed on purpose, so the message has to tell the developer exactly what
 * to do next. When a sibling entry in the registry shares the model's family prefix, it is named
 * along with its prices, because "register an override for the same prices" is the fix in almost
 * every real case.
 */
function unknownModelReason(model: string): string {
  const base =
    `No pricing found for model "${model}". AI CostGuard blocks unknown models by default ` +
    'because an uncosted call cannot be budgeted safely. ' +
    'Register the price with registerPricing([...]) or pass guard({ pricingOverrides: [...] }).';

  const sibling = findSiblingPricing(model);
  if (!sibling) return base;

  return (
    `${base} The closest built-in entry is "${sibling.model}" ` +
    `(input $${sibling.inputPer1kTokens}/1k, output $${sibling.outputPer1kTokens}/1k, checked ${sibling.lastUpdated}); ` +
    'reuse those values only if they are correct for this model.'
  );
}

function findSiblingPricing(model: string): ModelPricing | undefined {
  const normalized = model.toLowerCase();

  let best: ModelPricing | undefined;
  let bestLength = -1;
  for (const entry of listBuiltInPricing()) {
    const entryModel = entry.model.toLowerCase();
    const sharesFamily =
      normalized.startsWith(`${entryModel}-`) ||
      normalized.startsWith(`${entryModel}.`) ||
      entryModel.startsWith(`${normalized}-`) ||
      entryModel.startsWith(`${normalized}.`);
    if (!sharesFamily || entryModel.length <= bestLength) continue;
    best = entry;
    bestLength = entryModel.length;
  }

  return best;
}

function extractUsage(response: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!isRecord(response) || !isRecord(response.usage)) return undefined;
  const usage = response.usage;
  const inputTokens =
    readPositiveNumber(usage.prompt_tokens) ??
    readPositiveNumber(usage.input_tokens) ??
    readPositiveNumber(usage.inputTokens);
  const outputTokens =
    readPositiveNumber(usage.completion_tokens) ??
    readPositiveNumber(usage.output_tokens) ??
    readPositiveNumber(usage.outputTokens);

  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, outputTokens };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function validateMoney(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw configError(`${field} must be a non-negative finite number`);
  }
  return value;
}

function configError(message: string): GuardError {
  return new GuardError(message, undefined, 'CONFIG_INVALID');
}

function contextError(message: string): GuardError {
  return new GuardError(message, undefined, 'CONTEXT_INVALID');
}

function validateConfiguredPricing(entries: readonly ModelPricing[] | undefined, field: string): void {
  if (entries === undefined) return;
  if (!Array.isArray(entries)) throw configError(`${field} must be an array`);
  try {
    for (const [index, entry] of entries.entries()) validatePricing(entry, `${field}[${index}]`);
  } catch (error) {
    throw configError(error instanceof Error ? error.message : `${field} contains invalid pricing`);
  }
}

function sanitizeMoney(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

/**
 * Rounds a USD amount to micro-cent precision (1e-6 USD).
 *
 * Every stored money field and every money comparison in this file goes through this scale. The
 * tolerance is deliberately six decimals, not two: rounding to cents would hide a real overshoot of
 * up to $0.005 per request, which is exactly the class of bug a budget enforcer must not have.
 */
function roundMoney(value: number): number {
  return Math.round(sanitizeMoney(value) * 1_000_000) / 1_000_000;
}

/**
 * Converts a USD amount to exact integer micro-dollars for boundary comparisons.
 *
 * `roundMoney` is used for storage and for reporting, where a readable decimal is what a caller and a
 * block reason both want. Enforcement needs something stricter: two values that round to the same
 * 6-decimal figure must compare as equal, and the only way to guarantee that is to compare the
 * integers both sides quantize to. This is the same rule the shared Redis spend script applies, so
 * the in-process path and the shared path agree on an exactly-at-budget charge.
 */
function toMicros(value: number): number {
  return Math.round(sanitizeMoney(value) * 1_000_000);
}

/**
 * Adds two USD amounts on the micro-cent scale.
 *
 * Raw IEEE-754 addition of many small estimates accumulates visible drift: twenty $0.05 requests
 * sum to 0.9500000000000001, and a naive `reserved + estimated <= budget` test then rejects the
 * twentieth request even though it costs exactly the budget it was approved against. Adding on the
 * rounded scale keeps the stored value, the budget comparison, and the reported totals on one
 * consistent scale, so the two can never disagree.
 */
function addMoney(left: number, right: number): number {
  return roundMoney(sanitizeMoney(left) + sanitizeMoney(right));
}

function codeToAlertReason(code: GuardErrorCode): string {
  switch (code) {
    case 'CONFIG_INVALID':
      return 'config_invalid';
    case 'CONTEXT_INVALID':
      return 'context_invalid';
    case 'UNKNOWN_MODEL':
      return 'unknown_model';
    case 'OUTPUT_LIMIT_REQUIRED':
      return 'output_limit_required';
    case 'STREAMING_UNSUPPORTED':
      return 'streaming_unsupported';
    case 'SCOPE_LIMIT_EXCEEDED':
      return 'scope_limit_exceeded';
    case 'SHARED_BUDGET_UNAVAILABLE':
      return 'shared_budget_unavailable';
    case 'BUDGET_EXCEEDED':
      return 'budget_exceeded';
    case 'MAX_STEPS_EXCEEDED':
      return 'max_steps_exceeded';
    case 'LOOP_DETECTED':
      return 'loop_detected';
    case 'RETRY_STORM_DETECTED':
      return 'retry_storm';
  }
}

function inferProvider(model: string): string | undefined {
  const normalized = model.toLowerCase();
  if (normalized.startsWith('gpt-') || normalized.startsWith('o1') || normalized.startsWith('o3')) {
    return 'openai';
  }
  if (normalized.startsWith('claude-')) return 'anthropic';
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
