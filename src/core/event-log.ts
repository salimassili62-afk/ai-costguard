import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GuardEvent } from './types.js';

/**
 * Prompt retention mode for JSONL event logs.
 */
export type EventLogPromptMode = 'none' | 'preview';

/**
 * Stable JSONL record written for local dashboards and offline analysis.
 */
export interface GuardEventLogRecord {
  version: 1;
  timestamp: string;
  type: GuardEvent['type'];
  code?: GuardEvent['code'];
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
  state: {
    requestCount: number;
    blockedCount: number;
    totalCost: number;
    attemptedCost: number;
    blockedCost: number;
    actualCost: number;
  };
}

/**
 * Appends a redacted guard event to a local JSONL file.
 */
export function appendGuardEventLog(
  eventLogPath: string | undefined,
  event: GuardEvent,
  promptMode: EventLogPromptMode = 'none'
): void {
  if (!eventLogPath) return;

  try {
    mkdirSync(dirname(eventLogPath), { recursive: true });
    appendFileSync(eventLogPath, JSON.stringify(toEventLogRecord(event, promptMode)) + '\n', 'utf8');
  } catch {
    // Event logs are local observability only and must not affect guard decisions.
  }
}

function toEventLogRecord(event: GuardEvent, promptMode: EventLogPromptMode): GuardEventLogRecord {
  const record: GuardEventLogRecord = {
    version: 1,
    timestamp: new Date(event.context.timestamp).toISOString(),
    type: event.type,
    code: event.code,
    reason: event.reason,
    model: event.context.model,
    method: event.context.method,
    scopeKey: event.context.scopeKey ?? 'default',
    estimatedCost: roundMoney(event.context.estimatedCost),
    actualCost: event.context.actualCost === undefined ? undefined : roundMoney(event.context.actualCost),
    inputTokens: event.context.inputTokens,
    outputTokens: event.context.outputTokens,
    tokens: event.context.tokens,
    state: {
      requestCount: event.state.requestCount,
      blockedCount: event.state.blockedCount,
      totalCost: roundMoney(event.state.totalCost),
      attemptedCost: roundMoney(event.state.attemptedCost),
      blockedCost: roundMoney(event.state.blockedCost),
      actualCost: roundMoney(event.state.actualCost),
    },
  };

  if (promptMode === 'preview' && event.context.prompt.trim()) {
    record.promptPreview = event.context.prompt.slice(0, 160);
  }

  return record;
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
