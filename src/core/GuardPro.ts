import { Redis } from 'ioredis';
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

interface NormalizedBudget {
  maxUsd: number;
  thresholdUsd?: number;
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
  /** Evaluates the atomic spend increment Lua script. */
  eval(script: string, keys: number, key: string, amount: string, ttlSeconds: string): Promise<unknown>;
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
  /** Optional Redis-compatible client. When omitted, GuardPro pools ioredis clients by URL. */
  redisClient?: GuardProRedisClient;
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
}

/**
 * Redis-backed budget guard with local fallback when Redis is unavailable.
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
  private readonly localSpend = new Map<string, LocalSpendRecord>();
  private readonly thresholdAlertedKeys = new Set<string>();
  private directRedisFailed = false;
  private directRedisReady = false;

  /**
   * Creates a GuardPro instance and reuses a pooled Redis connection for the same URL.
   */
  constructor(config: GuardProConfig) {
    const budget = normalizeBudget(config.budget);

    this.redisUrl = config.redisUrl;
    this.budget = budget.maxUsd;
    this.budgetThresholdUsd = budget.thresholdUsd;
    this.windowSeconds = config.windowSeconds ?? 86_400;
    this.projectId = readString(config.projectId);
    this.runId = readString(config.runId);
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

  /**
   * Atomically charges estimated spend for a project and throws GuardError when budget is exceeded.
   */
  async checkAndCharge(projectId: string, estimatedCost: number): Promise<void> {
    if (!projectId.trim()) {
      throw new Error('GuardPro projectId must be a non-empty string');
    }

    if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
      throw new Error('GuardPro estimatedCost must be a finite non-negative number');
    }

    const key = this.getSpendKey(projectId);
    const redis = await this.getUsableRedis();
    const total = redis
      ? await this.incrementRedisOrFallback(redis, key, projectId, estimatedCost)
      : this.incrementLocal(projectId, estimatedCost);

    if (total > this.budget) {
      const context = this.createContext(projectId, estimatedCost);
      const reason =
        `Project "${projectId}" exceeded budget. ` +
        `Spend: $${total.toFixed(6)} / Budget: $${this.budget.toFixed(6)}`;

      void notifyBlockWebhooks(this.webhooks, { reason, context });
      void sendCostGuardAlert(
        this.alerts,
        this.createAlertPayload('blocked', 'budget_exceeded', 'critical', projectId, estimatedCost, total)
      );
      throw new GuardError(reason, context, 'BUDGET_EXCEEDED');
    }

    this.alertThresholdIfNeeded(projectId, total);
  }

  /**
   * Returns current spend for a project from Redis when available, otherwise from local fallback state.
   */
  async getSpend(projectId: string): Promise<number> {
    const redis = await this.getUsableRedis();
    if (redis) {
      try {
        const value = await redis.get(this.getSpendKey(projectId));
        return value ? Number(value) : 0;
      } catch {
        this.markDisconnected();
      }
    }

    return this.getLocal(projectId).total;
  }

  /**
   * Resets spend for a project in Redis when available and always clears local fallback state.
   */
  async resetSpend(projectId: string): Promise<void> {
    this.localSpend.delete(projectId);

    const redis = await this.getUsableRedis();
    if (!redis) return;

    try {
      await redis.del(this.getSpendKey(projectId));
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
   */
  async shutdown(): Promise<void> {
    if (this.poolEntry) {
      this.poolEntry.refs -= 1;
      if (this.poolEntry.refs <= 0) {
        GuardPro.pools.delete(this.redisUrl);
        await this.safeQuit(this.poolEntry.client);
      }
      return;
    }

    if (this.redisClient) {
      await this.safeQuit(this.redisClient);
    }
  }

  private static getPoolEntry(redisUrl: string): RedisPoolEntry {
    const existing = GuardPro.pools.get(redisUrl);
    if (existing) {
      existing.refs += 1;
      return existing;
    }

    const entry: RedisPoolEntry = {
      client: new Redis(redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      }),
      refs: 1,
      connected: false,
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
    if (!this.poolEntry && this.directRedisFailed) return null;
    if (client.status === 'ready') return client;

    if (this.poolEntry) {
      if (this.poolEntry.connected) return client;
      this.poolEntry.connectPromise ??= this.connect(client);
      return this.poolEntry.connectPromise;
    }

    return this.connect(client);
  }

  private async connect(client: GuardProRedisClient): Promise<GuardProRedisClient | null> {
    try {
      await client.connect?.();
      if (this.poolEntry) {
        this.poolEntry.connected = client.status === undefined || client.status === 'ready';
        this.poolEntry.connectPromise = undefined;
      } else {
        this.directRedisFailed = false;
        this.directRedisReady = true;
      }
      return client;
    } catch {
      this.markDisconnected();
      return null;
    }
  }

  private async incrementRedisOrFallback(
    redis: GuardProRedisClient,
    key: string,
    projectId: string,
    estimatedCost: number
  ): Promise<number> {
    try {
      return await this.incrementRedis(redis, key, estimatedCost);
    } catch {
      this.markDisconnected();
      return this.incrementLocal(projectId, estimatedCost);
    }
  }

  private async incrementRedis(redis: GuardProRedisClient, key: string, estimatedCost: number): Promise<number> {
    const script = `
      local total = redis.call("INCRBYFLOAT", KEYS[1], ARGV[1])
      local ttl = redis.call("TTL", KEYS[1])
      if ttl == -1 then
        redis.call("EXPIRE", KEYS[1], ARGV[2])
      end
      return total
    `;

    const total = await redis.eval(script, 1, key, estimatedCost.toString(), this.windowSeconds.toString());
    const numericTotal = Number(total);
    if (!Number.isFinite(numericTotal) || numericTotal < 0) {
      throw new Error('Redis returned an invalid spend total');
    }

    return numericTotal;
  }

  private incrementLocal(projectId: string, estimatedCost: number): number {
    const record = this.getLocal(projectId);
    record.total += estimatedCost;
    this.localSpend.set(projectId, record);
    return record.total;
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
    if (this.poolEntry) {
      this.poolEntry.connected = false;
      this.poolEntry.connectPromise = undefined;
    } else {
      this.directRedisFailed = true;
      this.directRedisReady = false;
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

function normalizeAlerts(alerts: GuardProConfig['alerts']): CostGuardAlertsConfig | undefined {
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

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validateMoney(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number`);
  }
  return value;
}

function roundMoney(value: number): number {
  return Math.round(validateMoney(value, 'money') * 1_000_000) / 1_000_000;
}
