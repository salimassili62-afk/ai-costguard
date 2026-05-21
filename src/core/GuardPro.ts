/*
 * Usage:
 *
 * import { GuardPro } from '@salimassili/ai-costguard';
 *
 * const guard = new GuardPro({
 *   redisUrl: 'redis://localhost:6379',
 *   budget: 25,
 *   windowSeconds: 86400,
 *   slackWebhook: process.env.SLACK_WEBHOOK,
 *   licenseKey: process.env.COSTGUARD_LICENSE
 * });
 *
 * await guard.checkAndCharge('production', 0.0042);
 * await guard.shutdown();
 *
 * No Redis? Get a free one at https://upstash.com
 */

import { Redis } from 'ioredis';
import { GuardError } from './GuardFree.js';
import type { RequestContext } from './types.js';

export interface GuardProConfig {
  redisUrl: string;
  budget: number;
  windowSeconds?: number;
  slackWebhook?: string;
  licenseKey?: string;
}

export class GuardPro {
  private readonly redis: Redis;
  private readonly budget: number;
  private readonly windowSeconds: number;
  private readonly slackWebhook?: string;
  private connected: boolean = false;

  constructor(config: GuardProConfig) {
    if (config.licenseKey && !validateLicense(config.licenseKey)) {
      throw new GuardError(
        'Invalid CostGuard Pro license key. ' +
        'Your key must be at least 16 characters and pass checksum validation.'
      );
    }

    try {
      this.redis = new Redis(config.redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });

      this.redis.on('ready', () => {
        this.connected = true;
      });

      this.redis.on('error', () => {
        this.connected = false;
      });

      this.redis.on('close', () => {
        this.connected = false;
      });

      this.redis.connect().then(() => {
        this.connected = true;
      }).catch(() => {
        throw new GuardError(
          'GuardPro requires a Redis connection. ' +
          'Pass a valid redisUrl in GuardProConfig. ' +
          'Free option: create an Upstash account at https://upstash.com ' +
          'and paste your Redis URL.'
        );
      });

    } catch (error) {
      if (error instanceof GuardError) throw error;
      throw new GuardError(
        'GuardPro failed to initialize Redis. ' +
        'Pass a valid redisUrl in GuardProConfig. ' +
        'Free option: create an Upstash account at https://upstash.com ' +
        'and paste your Redis URL.'
      );
    }

    this.budget = config.budget;
    this.windowSeconds = config.windowSeconds ?? 86400;
    this.slackWebhook = config.slackWebhook;
  }

  async checkAndCharge(projectId: string, estimatedCost: number): Promise<void> {
    if (!this.connected) {
      throw new GuardError(
        'GuardPro lost Redis connection. ' +
        'Spending is blocked until connection is restored.'
      );
    }

    let total: number;

    try {
      const key = this.getSpendKey(projectId);
      total = await this.incrementSpend(key, estimatedCost);
    } catch (error) {
      if (error instanceof GuardError) throw error;
      throw new GuardError(
        'GuardPro lost Redis connection. ' +
        'Spending is blocked until connection is restored.'
      );
    }

    if (total > this.budget) {
      if (this.slackWebhook) {
        try {
          await this.sendBudgetAlert(projectId, total);
        } catch {
          console.error('[CostGuard] Slack webhook failed — budget still enforced.');
        }
      }

      throw new GuardError(
        `Project "${projectId}" exceeded budget. ` +
        `Spend: $${total.toFixed(6)} / Budget: $${this.budget.toFixed(6)}`,
        this.createContext(projectId, estimatedCost)
      );
    }
  }

  async getSpend(projectId: string): Promise<number> {
    if (!this.connected) return 0;
    try {
      const value = await this.redis.get(this.getSpendKey(projectId));
      return value ? Number(value) : 0;
    } catch {
      return 0;
    }
  }

  async resetSpend(projectId: string): Promise<void> {
    if (!this.connected) return;
    try {
      await this.redis.del(this.getSpendKey(projectId));
    } catch {
      // silent — reset is best-effort
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async shutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // ignore close errors
    } finally {
      this.connected = false;
    }
  }

  private async incrementSpend(key: string, estimatedCost: number): Promise<number> {
    const script = `
      local total = redis.call("INCRBYFLOAT", KEYS[1], ARGV[1])
      local ttl = redis.call("TTL", KEYS[1])
      if ttl == -1 then
        redis.call("EXPIRE", KEYS[1], ARGV[2])
      end
      return total
    `;

    const total = await this.redis.eval(
      script,
      1,
      key,
      estimatedCost.toString(),
      this.windowSeconds.toString()
    );

    return Number(total);
  }

  private async sendBudgetAlert(projectId: string, currentSpend: number): Promise<void> {
    if (!this.slackWebhook) return;

    const response = await fetch(this.slackWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `[CostGuard] 🚨 Project "${projectId}" exceeded budget.\nSpend: $${currentSpend.toFixed(6)} / Budget: $${this.budget.toFixed(6)}`
      })
    });

    if (!response.ok) {
      throw new Error(`Slack webhook responded with status ${response.status}`);
    }
  }

  private getSpendKey(projectId: string): string {
    return `costguard:spend:${projectId}`;
  }

  private createContext(projectId: string, estimatedCost: number): RequestContext {
    return {
      model: 'unknown',
      tokens: 0,
      estimatedCost,
      timestamp: Date.now(),
      prompt: `project:${projectId}`
    };
  }
}

export function validateLicense(key: string): boolean {
  if (typeof key !== 'string' || key.length < 16) return false;
  const checksum = Array.from(key).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return checksum % 7 === 0;
}

export function getProGuard(config: GuardProConfig): GuardPro | null {
  if (config.licenseKey && !validateLicense(config.licenseKey)) return null;
  return new GuardPro(config);
}