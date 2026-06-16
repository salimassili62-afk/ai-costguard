import { getPricing } from '../pricing/index.js';
import { sendCostGuardAlert } from './alerts.js';
import { appendGuardEventLog } from './event-log.js';
import { GuardEventEmitter } from './events.js';
import { cosineSimilarity, maxCosineSimilarity } from './similarity.js';
import { estimateRequestTokens } from './tokenizer.js';
import type {
  CostGuardAlertPayload,
  CostGuardAlertsConfig,
  GuardConfig,
  GuardErrorCode,
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
const DEFAULT_GUARDED_METHODS = [
  'chat.completions.create',
  'completions.create',
  'responses.create',
  'messages.create',
] as const;

const RETRY_TERMS = /\b(retry|retries|retrying|rerun|repeat|again)\b/u;
const FAILURE_TERMS = /\b(error|fail|failed|failure|timeout|timed out|rate limit|429|unavailable|exception)\b/u;

interface NormalizedBudget {
  maxUsd: number;
  thresholdUsd?: number;
}

interface NormalizedGuardConfig {
  budget: number;
  budgetThresholdUsd?: number;
  behaviorAnalysis: boolean;
  maxHistory: number;
  historyTtlMs: number;
  maxSteps?: number;
  loopSimilarityThreshold: number;
  loopMinRepeats: number;
  loopWindowSize: number;
  retryThreshold: number;
  guardedMethods: string[];
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

  /**
   * Creates a process-local guard evaluator.
   */
  constructor(config: GuardConfig = {}, sharedState: GuardState = createGuardState()) {
    const loopSimilarityThreshold =
      config.loopDetection?.similarityThreshold ?? config.loopSimilarityThreshold ?? DEFAULT_LOOP_THRESHOLD;
    const loopMinRepeats = config.loopDetection?.minHistorySize ?? config.loopMinRepeats ?? DEFAULT_LOOP_MIN_REPEATS;
    const loopWindowSize = config.loopDetection?.windowSize ?? DEFAULT_LOOP_WINDOW_SIZE;

    validateLoopConfig(loopSimilarityThreshold, loopMinRepeats, loopWindowSize);
    const budget = normalizeBudget(config.budget);
    const scope = normalizeConfigScope(config);

    this.config = {
      budget: budget.maxUsd,
      budgetThresholdUsd: budget.thresholdUsd,
      behaviorAnalysis: config.behaviorAnalysis ?? true,
      maxHistory: config.maxHistory ?? DEFAULT_MAX_HISTORY,
      historyTtlMs: Math.max(0, config.historyTtlMs ?? DEFAULT_HISTORY_TTL_MS),
      maxSteps: config.maxSteps,
      loopSimilarityThreshold,
      loopMinRepeats: Math.trunc(loopMinRepeats),
      loopWindowSize: Math.trunc(loopWindowSize),
      retryThreshold: Math.max(1, Math.trunc(config.retryThreshold ?? DEFAULT_RETRY_THRESHOLD)),
      guardedMethods: config.guardedMethods ?? [...DEFAULT_GUARDED_METHODS],
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
    this.state.scopes ??= {};
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
    const model = typeof record.model === 'string' && record.model.trim() ? record.model.trim() : 'unknown';
    const scope = this.extractScope(record);
    const scopeKey = createScopeKey(scope);
    const tokenEstimate = estimateRequestTokens(record);
    if (tokenEstimate.approximate) {
      this.warnApproximateTokens(model, scopeKey);
    }
    const registryPricing = getPricing(model, this.config.pricingOverrides);
    const pricing = registryPricing ?? (this.config.unknownModelPolicy === 'fallback' ? this.config.unknownModelPricing : undefined);
    const inputPer1kTokens = pricing?.inputPer1kTokens ?? 0;
    const outputPer1kTokens = pricing?.outputPer1kTokens ?? 0;
    const estimatedCost = sanitizeMoney(
      (tokenEstimate.inputTokens / 1000) * inputPer1kTokens +
        (tokenEstimate.outputTokens / 1000) * outputPer1kTokens
    );
    return {
      model,
      pricingKnown: pricing !== undefined,
      pricing,
      tokens: tokenEstimate.tokens,
      inputTokens: tokenEstimate.inputTokens,
      approximateTokens: tokenEstimate.approximate,
      outputTokens: tokenEstimate.outputTokens,
      estimatedCost,
      timestamp: Date.now(),
      prompt: tokenEstimate.prompt.slice(0, 4000),
      method,
      scope,
      scopeKey,
    };
  }

  /**
   * Checks a request context, records allowed calls, emits events, and throws GuardError on block.
   */
  check(context: RequestContext): GuardCheckResult {
    normalizeRequestContext(context);
    const scope = this.getScopeState(context);
    this.pruneScope(scope, Date.now());
    this.recordAttempt(scope, context);
    this.emit('cost', context);

    if (context.pricingKnown === false) {
      return this.block('UNKNOWN_MODEL', `No pricing found for model "${context.model}".`, context);
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

    this.recordAllowed(scope, context);
    this.emit('allow', context);
    this.alertThresholdIfNeeded(scope, context);

    return { decision: 'allow', context };
  }

  /**
   * Reconciles actual provider usage from OpenAI/Anthropic-like response objects when available.
   */
  recordActualUsage(context: RequestContext, response: unknown): void {
    if (!context.pricing) return;

    const usage = extractUsage(response);
    if (!usage) return;

    const inputTokens = usage.inputTokens ?? context.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? context.outputTokens ?? 0;
    const actualCost =
      (inputTokens / 1000) * context.pricing.inputPer1kTokens +
      (outputTokens / 1000) * context.pricing.outputPer1kTokens;

    if (!Number.isFinite(actualCost) || actualCost < 0) return;

    context.actualCost = actualCost;
    this.state.actualCost += actualCost;
    const scope = this.getScopeState(context);
    scope.actualCost += actualCost;
  }

  private checkBudget(scope: GuardScopeState, context: RequestContext): string | undefined {
    if (scope.totalCost + context.estimatedCost <= this.config.budget) return undefined;
    return `Budget exceeded: estimated $${(scope.totalCost + context.estimatedCost).toFixed(6)} / $${this.config.budget.toFixed(6)}`;
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
    this.state.attemptedCost += context.estimatedCost;
    scope.attemptedCost += context.estimatedCost;
  }

  private recordAllowed(scope: GuardScopeState, context: RequestContext): void {
    this.state.requestCount += 1;
    this.state.totalCost += context.estimatedCost;
    this.state.lastRequestTime = Date.now();

    scope.requestCount += 1;
    scope.totalCost += context.estimatedCost;
    scope.lastRequestTime = this.state.lastRequestTime;

    this.pushHistory(scope, 'recentPrompts', context.prompt);
    if (hasRetrySignal(context.prompt)) {
      this.pushHistory(scope, 'recentRetries', context.prompt);
    }
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
    this.state.blockedCount += 1;
    this.state.blockedCost += context.estimatedCost;
    scope.blockedCount += 1;
    scope.blockedCost += context.estimatedCost;
    this.emit('block', context, reason, code);

    void notifyBlockWebhooks(this.config.webhooks, { reason, context });
    void sendCostGuardAlert(this.config.alerts, this.createAlertPayload('blocked', codeToAlertReason(code), 'critical', context, {
      estimatedSavedUsd: context.estimatedCost,
      budgetUsedUsd: scope.totalCost,
    }));

    throw new GuardError(reason, context, code, { similarity, scopeKey: context.scopeKey ?? 'default' });
  }

  private emit(type: GuardEventName, context: RequestContext, reason?: string, code?: GuardErrorCode): void {
    const event = {
      type,
      context,
      code,
      reason,
      state: { ...this.state, scopes: { ...this.state.scopes } },
    };

    appendGuardEventLog(this.config.eventLogPath, event, this.config.eventLogPrompt);
    this.emitter.emit(event);
  }

  private getScopeState(context: RequestContext): GuardScopeState {
    const scopeKey = context.scopeKey ?? createScopeKey(context.scope);
    this.state.scopes ??= {};
    const existing = this.state.scopes[scopeKey];
    if (existing) {
      hydrateScopeState(existing);
      return existing;
    }

    const fresh = createScopeState();
    this.state.scopes[scopeKey] = fresh;
    return fresh;
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
    if (thresholdUsd === undefined || scope.totalCost < thresholdUsd) return;

    const scopeKey = context.scopeKey ?? createScopeKey(context.scope);
    if (this.thresholdAlertedScopes.has(scopeKey)) return;

    this.thresholdAlertedScopes.add(scopeKey);
    void sendCostGuardAlert(
      this.config.alerts,
      this.createAlertPayload('threshold', 'budget_threshold', 'warning', context, {
        budgetUsedUsd: scope.totalCost,
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
    scopes: {},
  };
}

function createScopeState(): GuardScopeState {
  return {
    requestCount: 0,
    totalCost: 0,
    attemptedCost: 0,
    blockedCost: 0,
    actualCost: 0,
    lastRequestTime: 0,
    blockedCount: 0,
    recentPrompts: [],
    recentRetries: [],
  };
}

function hydrateScopeState(state: GuardScopeState): void {
  state.requestCount ??= 0;
  state.totalCost ??= 0;
  state.attemptedCost ??= state.totalCost ?? 0;
  state.blockedCost ??= 0;
  state.actualCost ??= 0;
  state.lastRequestTime ??= 0;
  state.blockedCount ??= 0;
  state.recentPrompts ??= [];
  state.recentRetries ??= [];
}

function normalizeBudget(configBudget: GuardConfig['budget']): NormalizedBudget {
  if (configBudget === undefined) return { maxUsd: DEFAULT_BUDGET };

  if (typeof configBudget === 'number') {
    return { maxUsd: validateMoney(configBudget, 'budget') };
  }

  if (!isRecord(configBudget)) {
    throw new Error('budget must be a non-negative number or { maxUsd } object');
  }

  const maxUsd = validateMoney(configBudget.maxUsd, 'budget.maxUsd');
  const thresholdUsd =
    configBudget.thresholdUsd === undefined
      ? normalizeThresholdPercent(configBudget.thresholdPercent, maxUsd)
      : validateMoney(configBudget.thresholdUsd, 'budget.thresholdUsd');

  if (thresholdUsd !== undefined && thresholdUsd > maxUsd) {
    throw new Error('budget threshold must be less than or equal to budget.maxUsd');
  }

  return { maxUsd, thresholdUsd };
}

function normalizeThresholdPercent(value: unknown, maxUsd: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error('budget.thresholdPercent must be a number greater than 0 and less than or equal to 1');
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
    throw new Error('alerts.timeoutMs must be a non-negative number');
  }

  if (alerts.format !== undefined && alerts.format !== 'json' && alerts.format !== 'slack') {
    throw new Error('alerts.format must be "json" or "slack"');
  }

  for (const event of alerts.events ?? []) {
    if (event !== 'blocked' && event !== 'threshold') {
      throw new Error('alerts.events can only include "blocked" or "threshold"');
    }
  }

  return {
    ...alerts,
    webhookUrl: readString(alerts.webhookUrl),
  };
}

function validateLoopConfig(similarityThreshold: number, minHistorySize: number, windowSize: number): void {
  if (!Number.isFinite(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) {
    throw new Error('loopDetection.similarityThreshold must be between 0 and 1');
  }

  if (!Number.isFinite(minHistorySize) || minHistorySize < 1) {
    throw new Error('loopDetection.minHistorySize must be at least 1');
  }

  if (!Number.isFinite(windowSize) || windowSize < 1) {
    throw new Error('loopDetection.windowSize must be at least 1');
  }
}

function normalizeRequestContext(context: RequestContext): void {
  context.model = readString(context.model) ?? 'unknown';
  context.tokens = sanitizeCount(context.tokens);
  context.inputTokens = context.inputTokens === undefined ? undefined : sanitizeCount(context.inputTokens);
  context.outputTokens = context.outputTokens === undefined ? undefined : sanitizeCount(context.outputTokens);
  context.estimatedCost = sanitizeMoney(context.estimatedCost);
  context.actualCost = context.actualCost === undefined ? undefined : sanitizeMoney(context.actualCost);
  context.timestamp = Number.isFinite(context.timestamp) ? context.timestamp : Date.now();
  context.prompt = typeof context.prompt === 'string' ? context.prompt : '';
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
  const projectId = normalizeScopePart(scope?.projectId);
  const userId = normalizeScopePart(scope?.userId);
  const sessionId = normalizeScopePart(scope?.sessionId);
  const runId = normalizeScopePart(scope?.runId);
  if (!projectId && !userId && !sessionId && !runId) return 'default';
  return `project:${projectId ?? '*'}|user:${userId ?? '*'}|session:${sessionId ?? '*'}|run:${runId ?? '*'}`;
}

function normalizeScopePart(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function hasRetrySignal(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  if (/\bretry(?:ing|ies)?\b/u.test(normalized)) return true;
  return RETRY_TERMS.test(normalized) && FAILURE_TERMS.test(normalized);
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
    throw new Error(`${field} must be a non-negative finite number`);
  }
  return value;
}

function sanitizeMoney(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

function roundMoney(value: number): number {
  return Math.round(sanitizeMoney(value) * 1_000_000) / 1_000_000;
}

function codeToAlertReason(code: GuardErrorCode): string {
  switch (code) {
    case 'UNKNOWN_MODEL':
      return 'unknown_model';
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
