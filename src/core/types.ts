import type { ModelPricing } from '../pricing/index.js';

/**
 * Stable machine-readable reasons for blocked requests.
 */
export type GuardErrorCode =
  | 'UNKNOWN_MODEL'
  | 'BUDGET_EXCEEDED'
  | 'MAX_STEPS_EXCEEDED'
  | 'LOOP_DETECTED'
  | 'RETRY_STORM_DETECTED';

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
 * Alert event names supported by the local webhook alert API.
 */
export type CostGuardAlertEvent = 'blocked' | 'threshold';

/**
 * Alert severity used in local webhook payloads.
 */
export type CostGuardAlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Local webhook alert configuration. Alerts are best-effort and disabled unless webhookUrl is supplied.
 */
export interface CostGuardAlertsConfig {
  /** User-owned webhook endpoint. Never logged by AI CostGuard. */
  webhookUrl?: string;
  /** Alert events to send. Defaults to ["blocked"]. */
  events?: CostGuardAlertEvent[];
  /** Per-alert timeout in milliseconds. Defaults to 1500. */
  timeoutMs?: number;
  /** Payload format. Defaults to "json". */
  format?: 'json' | 'slack';
  /** Convenience flag for Slack-compatible message bodies. */
  slack?: boolean;
}

/**
 * Stable local webhook payload sent for alert events.
 */
export interface CostGuardAlertPayload {
  event: CostGuardAlertEvent;
  reason: string;
  severity: CostGuardAlertSeverity;
  projectId?: string;
  runId?: string;
  model?: string;
  provider?: string;
  estimatedCostUsd?: number;
  estimatedSavedUsd?: number;
  budgetLimitUsd?: number;
  budgetUsedUsd?: number;
  timestamp: string;
  packageName: '@salimassili/ai-costguard';
  packageVersion?: string;
}

/**
 * Budget configuration. A number keeps legacy behavior; object form enables threshold alerts.
 */
export interface GuardBudgetConfig {
  /** Maximum process-local estimated spend in USD. */
  maxUsd: number;
  /** Optional threshold as a fraction from 0 to 1, for example 0.8 for 80%. */
  thresholdPercent?: number;
  /** Optional absolute threshold in USD. Takes precedence over thresholdPercent. */
  thresholdUsd?: number;
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
  /** Agent run identifier used by alert payloads and scope isolation. */
  runId?: string;
}

/**
 * Runtime configuration for the free process-local guard.
 */
export interface GuardConfig {
  /** Process-local budget in USD for each scope. Defaults to 10. */
  budget?: number | GuardBudgetConfig;
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
  /** Structured loop detection tuning. Takes precedence over legacy loopSimilarityThreshold/loopMinRepeats. */
  loopDetection?: {
    /** Similarity threshold from 0 to 1. Defaults to 0.85. */
    similarityThreshold?: number;
    /** Number of prior similar prompts required before loop blocking. Defaults to 2. */
    minHistorySize?: number;
    /** Number of recent prompts compared for loop detection. Defaults to 5. */
    windowSize?: number;
  };
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
  /** Local webhook alerts for block and threshold events. Disabled unless webhookUrl is supplied. */
  alerts?: CostGuardAlertsConfig;
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
  /** Top-level project identifier, equivalent to scope.projectId when scope omits projectId. */
  projectId?: string;
  /** Top-level run identifier, equivalent to scope.runId when scope omits runId. */
  runId?: string;
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
  /** True when dependency-free approximate token counting was used. */
  approximateTokens?: boolean;
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
