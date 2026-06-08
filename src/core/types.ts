import type { ModelPricing } from '../pricing/index.js';

/**
 * Stable machine-readable reasons for blocked requests.
 */
export type GuardErrorCode =
  | 'UNKNOWN_MODEL'
  | 'BUDGET_EXCEEDED'
  | 'MAX_STEPS_EXCEEDED'
  | 'LOOP_DETECTED'
  | 'RETRY_STORM_DETECTED'
  /** Reserved for compatibility; current GuardPro does not enforce local licenses. */
  | 'INVALID_LICENSE';

/**
 * Webhook destinations used by the guard when a request is blocked.
 */
export interface GuardWebhookConfig {
  /** Slack incoming webhook URL. */
  slack?: string;
  /** Discord incoming webhook URL. */
  discord?: string;
  /** Number of retry attempts after the first failed POST. Defaults to 2. */
  retries?: number;
  /** Per-request timeout in milliseconds. Defaults to 1500. */
  timeoutMs?: number;
}

/**
 * Scope used to isolate budgets and behavior history.
 */
export interface GuardScope {
  /** Product, tenant, or application project identifier. */
  projectId?: string;
  /** End-user identifier. */
  userId?: string;
  /** Agent run, workflow, request, or conversation identifier. */
  sessionId?: string;
}

/**
 * Runtime configuration for the free process-local guard.
 */
export interface GuardConfig {
  /** Process-local budget in USD for each scope. Defaults to 10. */
  budget?: number;
  /** Enables loop, retry-storm, and step-count checks. Defaults to true. */
  behaviorAnalysis?: boolean;
  /** Maximum prompt history retained for similarity checks. Defaults to 32. */
  maxHistory?: number;
  /** Prompt/retry history TTL in milliseconds. Defaults to 5 minutes. */
  historyTtlMs?: number;
  /** Optional maximum number of allowed guarded calls in the current process. */
  maxSteps?: number;
  /** Cosine similarity threshold for trigram loop detection. Defaults to 0.85. */
  loopSimilarityThreshold?: number;
  /** Number of prior similar prompts required before loop blocking. Defaults to 2. */
  loopMinRepeats?: number;
  /** Number of retry/failure prompts allowed before a retry storm is blocked. Defaults to 2. */
  retryThreshold?: number;
  /** Known AI SDK method paths to guard. Defaults to common OpenAI/Anthropic create methods. */
  guardedMethods?: string[];
  /** How unknown model pricing is handled. Defaults to "block". */
  unknownModelPolicy?: 'block' | 'fallback';
  /** Fallback pricing used only when unknownModelPolicy is "fallback". */
  unknownModelPricing?: ModelPricing;
  /** Default scope for requests that do not provide one. */
  scope?: GuardScope;
  /** Optional runtime pricing entries that take precedence over built-ins. */
  pricingOverrides?: ModelPricing[];
  /** Slack and Discord webhook destinations for block events. */
  webhooks?: GuardWebhookConfig;
  /** Optional JSONL file path for local dashboard/event history. Disabled by default. */
  eventLogPath?: string;
  /** Prompt logging mode for eventLogPath. Defaults to "none". */
  eventLogPrompt?: 'none' | 'preview';
  /** Convenience Slack webhook URL. Equivalent to webhooks.slack. */
  slackWebhook?: string;
  /** Convenience Discord webhook URL. Equivalent to webhooks.discord. */
  discordWebhook?: string;
}

/**
 * Normalized request data evaluated before an AI API call is allowed.
 */
export interface RequestContext {
  /** Model name supplied by the request, or "unknown" when missing. */
  model: string;
  /** True when pricing came from the registry, overrides, or configured fallback. */
  pricingKnown?: boolean;
  /** Pricing entry used for estimation, when available. */
  pricing?: ModelPricing;
  /** Estimated total tokens, input plus reserved output. */
  tokens: number;
  /** Estimated input tokens. */
  inputTokens?: number;
  /** Reserved or requested output tokens. */
  outputTokens?: number;
  /** Estimated USD cost for the request. */
  estimatedCost: number;
  /** Actual USD cost reconciled from a provider usage response, when available. */
  actualCost?: number;
  /** Unix timestamp in milliseconds when the context was created. */
  timestamp: number;
  /** Prompt text used for loop and retry detection. */
  prompt: string;
  /** Client method name being guarded, when known. */
  method?: string;
  /** Scope used for budget and history isolation. */
  scope?: GuardScope;
  /** Stable normalized key derived from scope. */
  scopeKey?: string;
}

/**
 * Prompt history entry retained by the process-local guard.
 */
export interface PromptHistoryEntry {
  /** Prompt text retained for trigram similarity comparison. */
  prompt: string;
  /** Unix timestamp in milliseconds when the prompt was recorded. */
  timestamp: number;
}

/**
 * Mutable process-local state for one scope.
 */
export interface GuardScopeState {
  /** Number of allowed requests. */
  requestCount: number;
  /** Estimated allowed spend in USD. */
  totalCost: number;
  /** Estimated cost of all guarded attempts, including blocked attempts. */
  attemptedCost: number;
  /** Estimated cost blocked before provider execution. */
  blockedCost: number;
  /** Actual provider-reported spend reconciled from usage fields when available. */
  actualCost: number;
  /** Unix timestamp in milliseconds for the last allowed request. */
  lastRequestTime: number;
  /** Number of blocked requests. */
  blockedCount: number;
  /** Recent prompts retained for cosine similarity loop detection. */
  recentPrompts?: PromptHistoryEntry[];
  /** Recent retry/failure prompts retained for retry-storm detection. */
  recentRetries?: PromptHistoryEntry[];
  /** Optional session expiry timestamp used by stateful guards. */
  sessionExpiresAt?: number;
}

/**
 * Mutable aggregate process-local guard state.
 */
export interface GuardState extends GuardScopeState {
  /** Per-scope state keyed by project/user/session. */
  scopes?: Record<string, GuardScopeState>;
}

/**
 * Guard decision returned by the core evaluator.
 */
export type GuardDecision = 'allow' | 'block';

/**
 * Supported event names emitted by guarded clients.
 */
export type GuardEventName = 'block' | 'allow' | 'cost';

/**
 * Event payload emitted by a guard instance.
 */
export interface GuardEvent {
  /** Event name. */
  type: GuardEventName;
  /** Request context associated with the event. */
  context: RequestContext;
  /** Machine-readable block reason, present for block events. */
  code?: GuardErrorCode;
  /** Human-readable block reason, present for block events. */
  reason?: string;
  /** Snapshot of state at emit time. */
  state: Readonly<GuardState>;
}

/**
 * Callback invoked when a guard event is emitted.
 */
export type GuardEventHandler = (event: GuardEvent) => void;
