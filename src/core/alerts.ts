import type {
  CostGuardAlertEvent,
  CostGuardAlertPayload,
  CostGuardAlertsConfig,
} from './types.js';

const DEFAULT_ALERT_EVENTS: readonly CostGuardAlertEvent[] = ['blocked'];
const DEFAULT_TIMEOUT_MS = 1500;
const MIN_TIMEOUT_MS = 100;

/**
 * Sends a local webhook alert on a best-effort basis.
 */
export async function sendCostGuardAlert(
  config: CostGuardAlertsConfig | undefined,
  payload: CostGuardAlertPayload
): Promise<void> {
  if (!config) return;

  const webhookUrl = config.webhookUrl?.trim();
  if (!webhookUrl) return;

  const events = config.events?.length ? config.events : DEFAULT_ALERT_EVENTS;
  if (!events.includes(payload.event)) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(MIN_TIMEOUT_MS, config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    );

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: shouldUseSlackFormat(config) ? slackBody(payload) : JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Alerts are observability only; enforcement and application behavior must not depend on delivery.
  }
}

function shouldUseSlackFormat(config: CostGuardAlertsConfig): boolean {
  return config.slack === true || config.format === 'slack';
}

function slackBody(payload: CostGuardAlertPayload): string {
  const action =
    payload.event === 'blocked'
      ? `blocked ${humanReason(payload.reason)} before provider call`
      : `reported ${humanReason(payload.reason)}`;
  const saved =
    payload.estimatedSavedUsd === undefined
      ? ''
      : ` Estimated saved: $${payload.estimatedSavedUsd.toFixed(6)}.`;

  return JSON.stringify({
    text: `AI CostGuard ${action}.${saved}`,
  });
}

function humanReason(reason: string): string {
  return reason.replace(/_/gu, ' ');
}
