import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { GuardErrorCode, GuardEventName } from './core/types.js';

const DEFAULT_EVENT_LOG_PATH = '.ai-costguard/events.jsonl';
const DEFAULT_DASHBOARD_HOST = '127.0.0.1';
const DEFAULT_DASHBOARD_PORT = 4318;

/**
 * Parsed dashboard event from a JSONL event log.
 */
export interface DashboardEvent {
  version: 1;
  timestamp: string;
  type: GuardEventName;
  code?: GuardErrorCode;
  reason?: string;
  model: string;
  method?: string;
  scopeKey: string;
  estimatedCost: number;
  actualCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokens: number;
  promptPreview?: string;
}

/**
 * Aggregated local dashboard metrics.
 */
export interface DashboardSummary {
  eventLogPath: string;
  generatedAt: string;
  budgetUsd?: number;
  budgetUsedPercent?: number;
  requestsAllowed: number;
  requestsBlocked: number;
  estimatedSpendUsd: number;
  estimatedSavingsUsd: number;
  attemptedSpendUsd: number;
  actualSpendUsd: number;
  loopDetections: number;
  retryDetections: number;
  recentEvents: DashboardEvent[];
}

/**
 * Options for local dashboard summary/server commands.
 */
export interface DashboardOptions {
  eventLogPath?: string;
  budgetUsd?: number;
  host?: string;
  port?: number;
  recentLimit?: number;
}

/**
 * Returns the default local event log path.
 */
export function getDefaultEventLogPath(): string {
  return DEFAULT_EVENT_LOG_PATH;
}

/**
 * Reads dashboard events from a local JSONL event log.
 */
export function readDashboardEvents(eventLogPath = DEFAULT_EVENT_LOG_PATH): DashboardEvent[] {
  if (!existsSync(eventLogPath)) return [];

  const lines = readFileSync(eventLogPath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const events: DashboardEvent[] = [];
  for (const line of lines) {
    const event = parseDashboardEvent(line);
    if (event) events.push(event);
  }

  return events;
}

/**
 * Builds dashboard metrics from a local event log.
 */
export function summarizeDashboard(options: DashboardOptions = {}): DashboardSummary {
  const eventLogPath = options.eventLogPath ?? DEFAULT_EVENT_LOG_PATH;
  const recentLimit = Math.max(1, Math.trunc(options.recentLimit ?? 25));
  const events = readDashboardEvents(eventLogPath);
  const allowed = events.filter((event) => event.type === 'allow');
  const blocked = events.filter((event) => event.type === 'block');
  const costEvents = events.filter((event) => event.type === 'cost');
  const estimatedSpendUsd = sum(allowed.map((event) => event.estimatedCost));
  const estimatedSavingsUsd = sum(blocked.map((event) => event.estimatedCost));
  const attemptedSpendUsd = costEvents.length
    ? sum(costEvents.map((event) => event.estimatedCost))
    : estimatedSpendUsd + estimatedSavingsUsd;
  const actualSpendUsd = sum(events.map((event) => event.actualCost ?? 0));
  const budgetUsd = options.budgetUsd;

  return {
    eventLogPath,
    generatedAt: new Date().toISOString(),
    budgetUsd,
    budgetUsedPercent: budgetUsd && budgetUsd > 0 ? round((estimatedSpendUsd / budgetUsd) * 100, 2) : undefined,
    requestsAllowed: allowed.length,
    requestsBlocked: blocked.length,
    estimatedSpendUsd: roundMoney(estimatedSpendUsd),
    estimatedSavingsUsd: roundMoney(estimatedSavingsUsd),
    attemptedSpendUsd: roundMoney(attemptedSpendUsd),
    actualSpendUsd: roundMoney(actualSpendUsd),
    loopDetections: blocked.filter((event) => event.code === 'LOOP_DETECTED').length,
    retryDetections: blocked.filter((event) => event.code === 'RETRY_STORM_DETECTED').length,
    recentEvents: events.slice(-recentLimit).reverse(),
  };
}

/**
 * Formats a dashboard summary for terminal output.
 */
export function formatDashboardSummary(summary: DashboardSummary): string {
  const budgetLine =
    summary.budgetUsd === undefined
      ? `Budget used: $${summary.estimatedSpendUsd.toFixed(6)} estimated`
      : `Budget used: ${summary.budgetUsedPercent?.toFixed(2) ?? '0.00'}% ($${summary.estimatedSpendUsd.toFixed(
          6
        )} / $${summary.budgetUsd.toFixed(6)})`;

  return [
    'AI CostGuard local dashboard',
    `Event log: ${summary.eventLogPath}`,
    budgetLine,
    `Requests allowed: ${summary.requestsAllowed}`,
    `Requests blocked: ${summary.requestsBlocked}`,
    `Estimated spend: $${summary.estimatedSpendUsd.toFixed(6)}`,
    `Estimated savings: $${summary.estimatedSavingsUsd.toFixed(6)}`,
    `Attempted spend: $${summary.attemptedSpendUsd.toFixed(6)}`,
    `Actual spend: $${summary.actualSpendUsd.toFixed(6)}`,
    `Loop detections: ${summary.loopDetections}`,
    `Retry detections: ${summary.retryDetections}`,
    `Recent events: ${summary.recentEvents.length}`,
    '',
  ].join('\n');
}

/**
 * Starts a local-only HTTP dashboard server.
 */
export function startDashboardServer(options: DashboardOptions = {}): Promise<{ server: Server; url: string }> {
  const host = options.host ?? DEFAULT_DASHBOARD_HOST;
  const port = options.port ?? DEFAULT_DASHBOARD_PORT;
  const server = createServer((request, response) => {
    const summary = summarizeDashboard(options);

    if (request.url?.startsWith('/events.json')) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(summary, null, 2));
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(renderDashboardHtml(summary));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({ server, url: `http://${host}:${actualPort}` });
    });
  });
}

function renderDashboardHtml(summary: DashboardSummary): string {
  const recentRows = summary.recentEvents
    .map(
      (event) => `<tr>
        <td>${escapeHtml(event.timestamp)}</td>
        <td>${escapeHtml(event.type)}</td>
        <td>${escapeHtml(event.code ?? '')}</td>
        <td>${escapeHtml(event.model)}</td>
        <td>${escapeHtml(event.scopeKey)}</td>
        <td>$${event.estimatedCost.toFixed(6)}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI CostGuard Local Dashboard</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101418; color: #eef2f4; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    p { color: #a8b3bd; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 24px 0; }
    .metric { border: 1px solid #2d363e; border-radius: 8px; padding: 16px; background: #161c22; }
    .label { color: #8d99a5; font-size: 13px; }
    .value { margin-top: 8px; font-size: 24px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; background: #161c22; }
    th, td { border-bottom: 1px solid #2d363e; padding: 10px; text-align: left; font-size: 14px; }
    th { color: #a8b3bd; }
    code { color: #90cdf4; }
  </style>
</head>
<body>
  <main>
    <h1>AI CostGuard Local Dashboard</h1>
    <p>Local-only view generated from <code>${escapeHtml(summary.eventLogPath)}</code>. Refresh the page for updates.</p>
    <section class="grid">
      ${metric('Budget used', summary.budgetUsedPercent === undefined ? `$${summary.estimatedSpendUsd.toFixed(6)}` : `${summary.budgetUsedPercent.toFixed(2)}%`)}
      ${metric('Requests allowed', String(summary.requestsAllowed))}
      ${metric('Requests blocked', String(summary.requestsBlocked))}
      ${metric('Estimated spend', `$${summary.estimatedSpendUsd.toFixed(6)}`)}
      ${metric('Estimated savings', `$${summary.estimatedSavingsUsd.toFixed(6)}`)}
      ${metric('Loop detections', String(summary.loopDetections))}
      ${metric('Retry detections', String(summary.retryDetections))}
      ${metric('Actual spend', `$${summary.actualSpendUsd.toFixed(6)}`)}
    </section>
    <h2>Recent Guard Events</h2>
    <table>
      <thead><tr><th>Time</th><th>Type</th><th>Code</th><th>Model</th><th>Scope</th><th>Estimated Cost</th></tr></thead>
      <tbody>${recentRows || '<tr><td colspan="6">No events yet.</td></tr>'}</tbody>
    </table>
  </main>
</body>
</html>`;
}

function metric(label: string, value: string): string {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

function parseDashboardEvent(line: string): DashboardEvent | undefined {
  try {
    const value = JSON.parse(line) as Partial<DashboardEvent>;
    if (value.version !== 1 || !value.timestamp || !value.type || !value.model || !value.scopeKey) return undefined;
    if (typeof value.estimatedCost !== 'number' || typeof value.tokens !== 'number') return undefined;
    return value as DashboardEvent;
  } catch {
    return undefined;
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundMoney(value: number): number {
  return round(value, 6);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
