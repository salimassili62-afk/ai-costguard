import { sendCostGuardAlert } from './alerts.js';
import { GuardError } from './GuardCore.js';
import type {
  CostGuardAlertPayload,
  CostGuardAlertsConfig,
  GuardBudgetConfig,
  GuardWebhookConfig,
  RequestContext,
} from './types.js';
import { notifyBlockWebhooks } from './webhooks.js';

const MONEY_SCALE = 1_000_000;

/**
 * Atomic shared-spend decision script.
 *
 * All comparisons run on integer micro-dollars so the boundary is exact: Redis
 * float arithmetic would reject an exactly-at-budget charge such as
 * `0.2 + 0.1 > 0.3` because `0.2 + 0.1` evaluates to `0.30000000000000004`.
 *
 * ARGV[1] charge amount in micro-dollars, ARGV[2] window TTL in seconds,
 * ARGV[3] budget in micro-dollars. Returns {allowed, currentUsd, projectedUsd}
 * as decimal dollar strings, so the stored representation stays human readable
 * and backwards compatible with values written by earlier releases.
 */
const SPEND_DECISION_SCRIPT = `
  local SCALE = 1000000

  local function toUsd(micros)
    local sign = ""
    if micros < 0 then
      sign = "-"
      micros = -micros
    end
    local whole = math.floor(micros / SCALE)
    local fraction = micros - whole * SCALE
    local text = string.format("%06.0f", fraction)
    text = (string.gsub(text, "0+$", ""))
    if text == "" then
      return sign .. string.format("%.0f", whole)
    end
    return sign .. string.format("%.0f", whole) .. "." .. text
  end

  local function toMicros(value)
    local micros = math.floor(value * SCALE + 0.5)
    if micros > 9007199254740991 then
      return nil
    end
    return micros
  end

  local currentRaw = redis.call("GET", KEYS[1])
  local current = 0
  if currentRaw then
    local currentNumber = tonumber(currentRaw)
    if not currentNumber or currentNumber < 0 then
      return redis.error_reply("ai-costguard: unreadable spend value")
    end
    current = toMicros(currentNumber)
    if not current then
      return redis.error_reply("ai-costguard: spend value out of range")
    end
  end

  local amount = tonumber(ARGV[1])
  local budget = tonumber(ARGV[3])
  if not amount or not budget then
    return redis.error_reply("ai-costguard: invalid charge arguments")
  end

  local projected = current + amount
  if projected > budget then
    return {0, toUsd(current), toUsd(projected)}
  end

  local ttl = redis.call("TTL", KEYS[1])
  redis.call("SET", KEYS[1], toUsd(projected))
  if ttl >= 1 then
    redis.call("EXPIRE", KEYS[1], ttl)
  else
    redis.call("EXPIRE", KEYS[1], ARGV[2])
  end
  return {1, toUsd(projected), toUsd(projected)}
`;

/**
 * How long a failed Redis connection is left alone before another attempt is made.
 *
 * Without a cooldown, every guarded request during an outage starts its own TCP connect, so the
 * guard amplifies the incident it is supposed to survive. Requests inside the window fail closed
 * immediately instead of paying for a connection attempt.
 */
const DEFAULT_RECONNECT_COOLDOWN_MS = 1_000;

function createLazyRedisClient(redisUrl: string): GuardProRedisClient {
  let client: GuardProRedisClient | null = null;
  let pending: Promise<GuardProRedisClient> | null = null;
  const queuedListeners: Array<['ready' | 'error' | 'close', () => void]> = [];

  // The in-flight promise is cached so concurrent callers share one import and one socket.
  // Without it, two simultaneous guarded calls both observe `client === null` and each build a
  // separate connection, leaking one of them for the life of the process.
  function loadClient(): Promise<GuardProRedisClient> {
    if (client) return Promise.resolve(client);
    pending ??= (async () => {
      const imported = await import('ioredis').catch(() => {
        throw new Error(
          '[ai-costguard] Shared budget enforcement via Redis requires the optional ioredis peer. ' +
            'Run: npm install ioredis'
        );
      });

      const Redis = (imported as any).default ?? imported;
      const redis = new Redis(redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });

      for (const [eventName, handler] of queuedListeners) {
        redis.on?.(eventName, handler);
      }
      queuedListeners.length = 0;

      client = redis as GuardProRedisClient;
      return client;
    })().finally(() => {
      pending = null;
    });

    return pending;
  }

  return {
    on(eventName, handler) {
      if (client) {
        return client.on?.(eventName, handler);
      }
      queuedListeners.push([eventName, handler]);
      return undefined;
    },
    async connect() {
      const redis = await loadClient();
      await redis.connect?.();
      return redis;
    },
    async eval(script, keys, key, amount, ttlSeconds, budget) {
      const redis = await loadClient();
      return redis.eval(script, keys, key, amount, ttlSeconds, budget);
    },
    async get(key) {
      const redis = await loadClient();
      return redis.get(key);
    },
    async del(key) {
      const redis = await loadClient();
      return redis.del(key);
    },
    async quit() {
      if (!client) return undefined;
      return client.quit?.();
    },
  };
}

interface NormalizedBudget {
  maxUsd: number;
  thresholdUsd?: number;
}

interface ChargeDecision {
  allowed: boolean;
  total: number;
  projectedTotal: number;
}

/**
 * Minimal Redis client surface used by GuardPro. Supplying redisClient is useful for tests.
 */
export interface GuardProRedisClient {
  /** Optional connection status exposed by ioredis-compatible clients. */
  status?: string;
  /** Registers a connection event handler. */
  on?(eventName: 'ready' | 'error' | 'close', handler: () => void): unknown;
  /** Opens the Redis connection when the client is lazy. */
  connect?(): Promise<unknown>;
  /**
   * Evaluates the atomic spend decision Lua script.
   *
   * `amount` and `budget` are integer micro-dollar strings and the resolved
   * decision must be a `{ allowed, currentUsd, projectedUsd }` tuple of decimal
   * dollar strings. Custom clients must replicate the bundled script semantics.
   */
  eval(script: string, keys: number, key: string, amount: string, ttlSeconds: string, budget: string): Promise<unknown>;
  /** Reads the current spend value. */
  get(key: string): Promise<string | null>;
  /** Deletes a spend key. */
  del(key: string): Promise<unknown>;
  /** Closes the connection. */
  quit?(): Promise<unknown>;
}

/**
 * Configuration for Redis-backed budget enforcement.
 */
export interface GuardProConfig {
  /** Redis connection URL. Instances sharing this URL reuse one pooled connection. */
  redisUrl: string;
  /** Budget in USD for each project/session window. */
  budget: number | GuardBudgetConfig;
  /** Session TTL in seconds. Defaults to 86400. */
  windowSeconds?: number;
  /**
   * How long a failed Redis connection is left alone before another attempt is made, in
   * milliseconds. Defaults to 1000.
   *
   * Inside the window every call fails closed with `SHARED_BUDGET_UNAVAILABLE` without opening a
   * connection, so a Redis outage cannot be amplified into a connect storm by guarded traffic.
   */
  reconnectCooldownMs?: number;
  /** Default project identifier used in alert payloads when checkAndCharge supplies a project key. */
  projectId?: string;
  /** Agent run identifier used in alert payloads. */
  runId?: string;
  /** Local webhook alerts for block and threshold events. Disabled unless webhookUrl is supplied. */
  alerts?: CostGuardAlertsConfig;
  /** Slack webhook URL for budget block notifications. */
  slackWebhook?: string;
  /** Discord webhook URL for budget block notifications. */
  discordWebhook?: string;
  /** Combined webhook configuration. */
  webhooks?: GuardWebhookConfig;
  /** Explicitly permits unsafe process-local fallback when Redis is unavailable. Defaults to false. */
  allowLocalFallback?: boolean;
  /** Optional Redis-compatible client. When omitted, GuardPro pools ioredis clients by URL. */
  redisClient?: GuardProRedisClient;
  // The caller owns an injected client: GuardPro connects it lazily and never closes it, because the
  // same client may be shared with other guards. Only pooled clients created from redisUrl are
  // closed by shutdown().
}

interface LocalSpendRecord {
  total: number;
  expiresAt: number;
}

interface RedisPoolEntry {
  client: GuardProRedisClient;
  refs: number;
  connected: boolean;
  connectPromise?: Promise<GuardProRedisClient | null>;
  retryAfter: number;
}

/**
 * Redis-backed budget guard that fails closed when shared enforcement is unavailable.
 */
export class GuardPro {
  private static readonly pools = new Map<string, RedisPoolEntry>();

  private readonly redisUrl: string;
  private readonly redisClient?: GuardProRedisClient;
  private readonly poolEntry?: RedisPoolEntry;
  private readonly budget: number;
  private readonly budgetThresholdUsd?: number;
  private readonly windowSeconds: number;
  private readonly projectId?: string;
  private readonly runId?: string;
  private readonly alerts?: CostGuardAlertsConfig;
  private readonly webhooks?: GuardWebhookConfig;
  private readonly allowLocalFallback: boolean;
  private readonly reconnectCooldownMs: number;
  private readonly localSpend = new Map<string, LocalSpendRecord>();
  private readonly thresholdAlertedKeys = new Set<string>();
  private directRedisFailed = false;
  private directRedisReady = false;
  private directConnectPromise?: Promise<GuardProRedisClient | null>;
  private retryAfter = 0;

  /**
   * Creates a GuardPro instance and reuses a pooled Redis connection for the same URL.
   */
  constructor(config: GuardProConfig) {
    if (!config || typeof config !== 'object') {
      throw proConfigError('GuardPro config must be an object');
    }
    if (typeof config.redisUrl !== 'string') {
      throw proConfigError('GuardPro redisUrl must be a string');
    }
    const budget = normalizeBudget(config.budget);

    const windowSeconds = config.windowSeconds ?? 86_400;
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      throw new GuardError(
        'GuardPro windowSeconds must be a finite number greater than 0',
        undefined,
        'CONFIG_INVALID'
      );
    }

    const reconnectCooldownMs = config.reconnectCooldownMs ?? DEFAULT_RECONNECT_COOLDOWN_MS;
    if (!Number.isFinite(reconnectCooldownMs) || reconnectCooldownMs < 0) {
      throw proConfigError('GuardPro reconnectCooldownMs must be a finite number greater than or equal to 0');
    }

    this.redisUrl = config.redisUrl;
    this.budget = budget.maxUsd;
    this.budgetThresholdUsd = budget.thresholdUsd;
    this.windowSeconds = windowSeconds;
    this.reconnectCooldownMs = reconnectCooldownMs;
    this.projectId = readString(config.projectId);
    this.runId = readString(config.runId);
    this.allowLocalFallback = config.allowLocalFallback === true;
    this.alerts = normalizeAlerts(config.alerts);
    this.webhooks = {
      ...config.webhooks,
      slack: config.webhooks?.slack ?? config.slackWebhook,
      discord: config.webhooks?.discord ?? config.discordWebhook,
    };

    if (config.redisClient) {
      this.redisClient = config.redisClient;
      this.attachConnectionEvents(config.redisClient);
      return;
    }

    if (config.redisUrl.trim()) {
      this.poolEntry = GuardPro.getPoolEntry(config.redisUrl);
      this.redisClient = this.poolEntry.client;
    }
  }


  async checkAndCharge(projectId: string, estimatedCost: number): Promise<void> {
    if (typeof projectId !== 'string' || !projectId.trim()) {
      throw proConfigError('GuardPro projectId must be a non-empty string');
    }

    if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
      throw proConfigError('GuardPro estimatedCost must be a finite non-negative number');
    }

    const key = this.getSpendKey(projectId);
    const redis = await this.getUsableRedis();
    if (!redis && !this.allowLocalFallback) {
      throw this.sharedBudgetUnavailable(projectId);
    }

    const decision = redis
      ? await this.chargeRedisOrFallback(redis, key, projectId, estimatedCost)
      : this.chargeLocal(projectId, estimatedCost);

    if (!decision.allowed) {
      const context = this.createContext(projectId, estimatedCost);
      const reason =
        `Project "${projectId}" would exceed budget. ` +
        `Projected spend: $${decision.projectedTotal.toFixed(6)} / Budget: $${this.budget.toFixed(6)}. ` +
        `Current spend remains $${decision.total.toFixed(6)}.`;

      void notifyBlockWebhooks(this.webhooks, { reason, context });
      void sendCostGuardAlert(
        this.alerts,
        this.createAlertPayload('blocked', 'budget_exceeded', 'critical', projectId, estimatedCost, decision.total)
      );
      throw new GuardError(reason, context, 'BUDGET_EXCEEDED');
    }

    this.alertThresholdIfNeeded(projectId, decision.total);
  }

  async getSpend(projectId: string): Promise<number> {
    if (typeof projectId !== 'string' || !projectId.trim()) {
      throw proConfigError('GuardPro projectId must be a non-empty string');
    }

    const redis = await this.getUsableRedis();
    if (!redis && !this.allowLocalFallback) {
      throw this.sharedBudgetUnavailable(projectId);
    }
    if (redis) {
      try {
        const value = await redis.get(this.getSpendKey(projectId));
        if (value === null || value === undefined || value === '') {
          return 0;
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw this.sharedBudgetUnavailable(projectId);
        }
        this.markConnected();
        return roundMoney(parsed);
      } catch (error) {
        if (error instanceof GuardError) {
          throw error;
        }
        this.markDisconnected();
      }
    }

    return this.getLocal(projectId).total;
  }

  async resetSpend(projectId: string): Promise<void> {
    if (typeof projectId !== 'string' || !projectId.trim()) {
      throw proConfigError('GuardPro projectId must be a non-empty string');
    }

    this.localSpend.delete(projectId);

    const redis = await this.getUsableRedis();
    if (!redis && !this.allowLocalFallback) {
      throw this.sharedBudgetUnavailable(projectId);
    }
    if (!redis) return;

    try {
      await redis.del(this.getSpendKey(projectId));
      this.markConnected();
    } catch {
      this.markDisconnected();
    }
  }

  /**
   * Returns true when the pooled or supplied Redis client is currently connected.
   */
  isConnected(): boolean {
    if (this.poolEntry) return this.poolEntry.connected;
    return !this.directRedisFailed && (this.redisClient?.status === 'ready' || this.directRedisReady);
  }

  /**
   * Releases this instance's pooled Redis reference and closes the connection when unused.
   *
   * Only connections this class opened are closed. A client passed in through `redisClient`
   * belongs to the caller and may be shared with other guards, other libraries, or the caller's own
   * code, so shutting it down here would break every other holder of the same socket. Callers that
   * inject a client are responsible for closing it.
   */
  async shutdown(): Promise<void> {
    if (!this.poolEntry) return;

    this.poolEntry.refs -= 1;
    if (this.poolEntry.refs <= 0) {
      GuardPro.pools.delete(this.redisUrl);
      await this.safeQuit(this.poolEntry.client);
    }
  }

  private static getPoolEntry(redisUrl: string): RedisPoolEntry {
    const existing = GuardPro.pools.get(redisUrl);
    if (existing) {
      existing.refs += 1;
      return existing;
    }

    const entry: RedisPoolEntry = {
      client: createLazyRedisClient(redisUrl),
      refs: 1,
      connected: false,
      retryAfter: 0,
    };

    entry.client.on?.('ready', () => {
      entry.connected = true;
    });
    entry.client.on?.('error', () => {
      entry.connected = false;
    });
    entry.client.on?.('close', () => {
      entry.connected = false;
    });

    GuardPro.pools.set(redisUrl, entry);
    return entry;
  }

  private attachConnectionEvents(client: GuardProRedisClient): void {
    client.on?.('ready', () => {
      this.directRedisReady = true;
      this.directRedisFailed = false;
    });
    client.on?.('error', () => {
      this.directRedisReady = false;
      this.directRedisFailed = true;
    });
    client.on?.('close', () => {
      this.directRedisReady = false;
    });
  }

  private async getUsableRedis(): Promise<GuardProRedisClient | null> {
    const client = this.redisClient;
    if (!client) return null;

    // The cooldown is checked before readiness on purpose. A client can still report `ready` after
    // its last command failed, and a client that is mid-outage must not be handed back just because
    // its own status has not caught up yet.
    const retryAfter = this.poolEntry ? this.poolEntry.retryAfter : this.retryAfter;
    if (Date.now() < retryAfter) return null;

    if (client.status === 'ready') return client;

    // A client that has already served a command is trusted over its own status string. The status is
    // the weaker signal: drivers report it late, leave it in `wait`/`connecting` after a successful
    // handshake, and differ between versions. A command that returned proves the socket works, so
    // re-running connect() on the next request would only add connection churn to a healthy client.
    // The trust is dropped by markDisconnected() on the first failing command, which also starts the
    // cooldown. The pooled path below applies the same rule through `poolEntry.connected`.
    if (this.directRedisReady && !this.directRedisFailed) return client;

    if (this.poolEntry) {
      if (this.poolEntry.connected) return client;
      this.poolEntry.connectPromise ??= this.connect(client);
      return this.poolEntry.connectPromise;
    }

    this.directConnectPromise ??= this.connect(client).finally(() => {
      this.directConnectPromise = undefined;
    });
    return this.directConnectPromise;
  }

  private async connect(client: GuardProRedisClient): Promise<GuardProRedisClient | null> {
    try {
      await client.connect?.();

      // A client that exposes `status` is only usable once it reports `ready`. A client that
      // resolves connect() and then reports anything else has not joined the pool, and treating it
      // as connected would leave `connected` false with no cooldown set: every subsequent guarded
      // request would fall through to another connect() and the guard would turn one slow or
      // wedged connection into a connect attempt per request, which is the exact amplification
      // the cooldown exists to prevent.
      const ready = client.status === undefined || client.status === 'ready';
      const retryAfter = ready ? 0 : Date.now() + this.reconnectCooldownMs;

      if (this.poolEntry) {
        this.poolEntry.connected = ready;
        this.poolEntry.connectPromise = undefined;
        this.poolEntry.retryAfter = retryAfter;
      } else {
        this.directRedisFailed = !ready;
        this.directRedisReady = ready;
        this.retryAfter = retryAfter;
      }

      // Still handed back so the caller gets one attempt at the command. A client that reports a
      // non-ready status but can serve commands succeeds here and clears the cooldown through
      // markConnected(); one that cannot fails in chargeRedisOrFallback and fails closed.
      return client;
    } catch {
      this.markDisconnected();
      return null;
    }
  }

  private async chargeRedisOrFallback(
    redis: GuardProRedisClient,
    key: string,
    projectId: string,
    estimatedCost: number
  ): Promise<ChargeDecision> {
    try {
      const decision = await this.chargeRedis(redis, key, estimatedCost);
      this.markConnected();
      return decision;
    } catch {
      this.markDisconnected();
      if (!this.allowLocalFallback) {
        throw this.sharedBudgetUnavailable(projectId);
      }
      return this.chargeLocal(projectId, estimatedCost);
    }
  }

  private sharedBudgetUnavailable(projectId: string): GuardError {
    return new GuardError(
      `Shared budget enforcement is unavailable for project "${projectId}".`,
      this.createContext(projectId, 0),
      'SHARED_BUDGET_UNAVAILABLE'
    );
  }

  private async chargeRedis(redis: GuardProRedisClient, key: string, estimatedCost: number): Promise<ChargeDecision> {
    const result = await redis.eval(
      SPEND_DECISION_SCRIPT,
      1,
      key,
      String(toMicros(estimatedCost, 'estimatedCost')),
      String(Math.trunc(this.windowSeconds)),
      String(toMicros(this.budget, 'budget'))
    );

    return parseRedisChargeDecision(result);
  }

  /**
   * In-process fallback that is decision-identical to the Redis script.
   *
   * This runs the exact same arithmetic `SPEND_DECISION_SCRIPT` runs: the stored total, the charge,
   * and the budget are each converted to integer micro-dollars, and only the integers are compared.
   * Rounding the *sum* against an unrounded budget instead (the previous implementation) made the two
   * paths disagree at the boundary, so a budget of `0.0000005` blocked a `0.000001` charge locally
   * while the shared path allowed it, because both sides collapse to `1` micro-dollar and the
   * authoritative comparison `1 > 1` is false. A caller that fails over between Redis and the
   * fallback must not observe a different allow/block answer, so the integer comparison is
   * duplicated here rather than approximated.
   */
  private chargeLocal(projectId: string, estimatedCost: number): ChargeDecision {
    const record = this.getLocal(projectId);
    const currentMicros = toMicros(record.total, 'total');
    const amountMicros = toMicros(estimatedCost, 'estimatedCost');
    const budgetMicros = toMicros(this.budget, 'budget');
    const projectedMicros = currentMicros + amountMicros;

    if (projectedMicros > budgetMicros) {
      return {
        allowed: false,
        total: fromMicros(currentMicros),
        projectedTotal: fromMicros(projectedMicros),
      };
    }

    record.total = fromMicros(projectedMicros);
    this.localSpend.set(projectId, record);
    return {
      allowed: true,
      total: record.total,
      projectedTotal: record.total,
    };
  }

  private getLocal(projectId: string): LocalSpendRecord {
    const now = Date.now();
    const existing = this.localSpend.get(projectId);

    if (existing && existing.expiresAt > now) {
      return existing;
    }

    const fresh = {
      total: 0,
      expiresAt: now + this.windowSeconds * 1000,
    };
    this.localSpend.set(projectId, fresh);
    return fresh;
  }

  private markDisconnected(): void {
    const retryAfter = Date.now() + this.reconnectCooldownMs;
    if (this.poolEntry) {
      this.poolEntry.connected = false;
      this.poolEntry.connectPromise = undefined;
      this.poolEntry.retryAfter = retryAfter;
    } else {
      this.directRedisFailed = true;
      this.directRedisReady = false;
      this.retryAfter = retryAfter;
    }
  }

  /**
   * Clears the failure state after a command actually succeeds.
   *
   * Without this, a client whose `status` is still `ready` after a single transient command error
   * would be reported as disconnected forever: nothing would ever clear the flag except a fresh
   * `connect()`, which a ready client is never asked for.
   */
  private markConnected(): void {
    if (this.poolEntry) {
      this.poolEntry.connected = true;
      this.poolEntry.retryAfter = 0;
    } else {
      this.directRedisFailed = false;
      this.directRedisReady = true;
      this.retryAfter = 0;
    }
  }

  private async safeQuit(client: GuardProRedisClient): Promise<void> {
    try {
      await client.quit?.();
    } catch {
      // Best-effort shutdown only.
    }
  }

  private getSpendKey(projectId: string): string {
    return `costguard:spend:${projectId}`;
  }

  private createContext(projectId: string, estimatedCost: number): RequestContext {
    return {
      model: 'unknown',
      pricingKnown: false,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost,
      timestamp: Date.now(),
      prompt: `project:${projectId}`,
    };
  }

  private alertThresholdIfNeeded(projectId: string, total: number): void {
    if (this.budgetThresholdUsd === undefined || total < this.budgetThresholdUsd) return;

    const key = this.getSpendKey(projectId);
    if (this.thresholdAlertedKeys.has(key)) return;

    this.thresholdAlertedKeys.add(key);
    void sendCostGuardAlert(
      this.alerts,
      this.createAlertPayload('threshold', 'budget_threshold', 'warning', projectId, undefined, total)
    );
  }

  private createAlertPayload(
    event: 'blocked' | 'threshold',
    reason: string,
    severity: 'warning' | 'critical',
    projectId: string,
    estimatedCost: number | undefined,
    total: number
  ): CostGuardAlertPayload {
    return {
      event,
      reason,
      severity,
      projectId: this.projectId ?? projectId,
      runId: this.runId,
      estimatedCostUsd: estimatedCost === undefined ? undefined : roundMoney(estimatedCost),
      estimatedSavedUsd: estimatedCost === undefined ? undefined : roundMoney(estimatedCost),
      budgetLimitUsd: roundMoney(this.budget),
      budgetUsedUsd: roundMoney(total),
      timestamp: new Date().toISOString(),
      packageName: '@salimassili/ai-costguard',
    };
  }
}

/**
 * Creates GuardPro.
 */
export function getProGuard(config: GuardProConfig): GuardPro {
  return new GuardPro(config);
}

function normalizeBudget(configBudget: GuardProConfig['budget']): NormalizedBudget {
  if (typeof configBudget === 'number') {
    return { maxUsd: validateMoney(configBudget, 'budget') };
  }

  if (!configBudget || typeof configBudget !== 'object') {
    throw proConfigError('budget must be a non-negative number or { maxUsd } object');
  }

  const maxUsd = validateMoney(configBudget.maxUsd, 'budget.maxUsd');
  const thresholdUsd =
    configBudget.thresholdUsd === undefined
      ? normalizeThresholdPercent(configBudget.thresholdPercent, maxUsd)
      : validateMoney(configBudget.thresholdUsd, 'budget.thresholdUsd');

  if (thresholdUsd !== undefined && thresholdUsd > maxUsd) {
    throw proConfigError('budget threshold must be less than or equal to budget.maxUsd');
  }

  return { maxUsd, thresholdUsd };
}

function normalizeThresholdPercent(value: unknown, maxUsd: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw proConfigError('budget.thresholdPercent must be a number greater than 0 and less than or equal to 1');
  }
  return maxUsd * value;
}

function normalizeAlerts(alerts: GuardProConfig['alerts']): CostGuardAlertsConfig | undefined {
  if (!alerts) return undefined;

  if (alerts.timeoutMs !== undefined && (!Number.isFinite(alerts.timeoutMs) || alerts.timeoutMs < 0)) {
    throw proConfigError('alerts.timeoutMs must be a non-negative number');
  }

  if (alerts.format !== undefined && alerts.format !== 'json' && alerts.format !== 'slack') {
    throw proConfigError('alerts.format must be "json" or "slack"');
  }

  for (const event of alerts.events ?? []) {
    if (event !== 'blocked' && event !== 'threshold') {
      throw proConfigError('alerts.events can only include "blocked" or "threshold"');
    }
  }

  return {
    ...alerts,
    webhookUrl: readString(alerts.webhookUrl),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validateMoney(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw proConfigError(`${field} must be a non-negative finite number`);
  }
  return value;
}

function proConfigError(message: string): GuardError {
  return new GuardError(message, undefined, 'CONFIG_INVALID');
}

function parseRedisChargeDecision(result: unknown): ChargeDecision {
  if (!Array.isArray(result) || result.length < 3) {
    throw new Error('Redis returned an invalid spend decision');
  }

  const allowedFlag = Number(result[0]);
  const total = Number(result[1]);
  const projectedTotal = Number(result[2]);

  if (
    (allowedFlag !== 0 && allowedFlag !== 1) ||
    !Number.isFinite(total) ||
    total < 0 ||
    !Number.isFinite(projectedTotal) ||
    projectedTotal < 0
  ) {
    throw new Error('Redis returned an invalid spend decision');
  }

  return {
    allowed: allowedFlag === 1,
    total: roundMoney(total),
    projectedTotal: roundMoney(projectedTotal),
  };
}

function roundMoney(value: number): number {
  return Math.round(validateMoney(value, 'money') * MONEY_SCALE) / MONEY_SCALE;
}

/** Converts a validated USD amount to exact integer micro-dollars. */
function toMicros(value: number, field: string): number {
  const micros = Math.round(validateMoney(value, field) * MONEY_SCALE);
  if (!Number.isSafeInteger(micros)) {
    throw proConfigError(`${field} exceeds the maximum supported amount of 9007199254.740991`);
  }
  return micros;
}

/** Converts integer micro-dollars back to the 6-decimal USD value stored in memory. */
function fromMicros(micros: number): number {
  return micros / MONEY_SCALE;
}
