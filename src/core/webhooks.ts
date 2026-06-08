import type { GuardWebhookConfig, RequestContext } from './types.js';

/**
 * Payload sent to configured block webhooks.
 */
export interface GuardWebhookPayload {
  /** Human-readable reason the request was blocked. */
  reason: string;
  /** Request context associated with the block. */
  context: RequestContext;
}

/**
 * Posts a block notification to Slack and Discord webhooks with exponential backoff.
 */
export async function notifyBlockWebhooks(
  config: GuardWebhookConfig | undefined,
  payload: GuardWebhookPayload
): Promise<void> {
  if (!config?.slack && !config?.discord) return;

  await Promise.all([
    config.slack ? postWithBackoff(config.slack, slackBody(payload), config) : Promise.resolve(),
    config.discord ? postWithBackoff(config.discord, discordBody(payload), config) : Promise.resolve(),
  ]);
}

function slackBody(payload: GuardWebhookPayload): string {
  return JSON.stringify({
    text:
      `[AI CostGuard] Blocked request: ${payload.reason}\n` +
      `Model: ${payload.context.model}\n` +
      `Estimated cost: $${payload.context.estimatedCost.toFixed(6)}`,
  });
}

function discordBody(payload: GuardWebhookPayload): string {
  return JSON.stringify({
    content:
      `[AI CostGuard] Blocked request: ${payload.reason}\n` +
      `Model: ${payload.context.model}\n` +
      `Estimated cost: $${payload.context.estimatedCost.toFixed(6)}`,
  });
}

async function postWithBackoff(url: string, body: string, config: GuardWebhookConfig): Promise<void> {
  const retries = Math.max(0, config.retries ?? 2);
  const timeoutMs = Math.max(100, config.timeoutMs ?? 1500);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: controller.signal,
        });

        if (response.ok) return;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Webhooks are observability only; guard enforcement must remain independent.
    }

    if (attempt < retries) {
      await delay(100 * 2 ** attempt);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
