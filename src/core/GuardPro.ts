import { Redis } from 'ioredis';
import { GuardError } from './GuardCore.js';
import type { GuardWebhookConfig, RequestContext } from './types.js';
import { notifyBlockWebhooks } from './webhooks.js';

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
  budget: number;
  /** Session TTL in seconds. Defaults to 86400. */
  windowSeconds?: number;
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
  private readonly windowSeconds: number;
  private readonly webhooks?: GuardWebhookConfig;
  private readonly localSpend = new Map<string, LocalSpendRecord>();
  private directRedisFailed = false;
  private directRedisReady = false;

  /**
   * Creates a GuardPro instance and reuses a pooled Redis connection for the same URL.
   */
  constructor(config: GuardProConfig) {
    this.redisUrl = config.redisUrl;
    this.budget = config.budget;
    this.windowSeconds = config.windowSeconds ?? 86_400;
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

      await notifyBlockWebhooks(this.webhooks, { reason, context });
      throw new GuardError(reason, context, 'BUDGET_EXCEEDED');
    }
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
    return Number(total);
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
}

/**
 * Creates GuardPro.
 */
export function getProGuard(config: GuardProConfig): GuardPro {
  return new GuardPro(config);
}
