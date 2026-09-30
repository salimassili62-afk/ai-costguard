import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describeScope } from './scope-fingerprint.js';
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
  /**
   * Scope label, either `default` or the same `scope#xxxxxxxx` pseudonym used in block reasons.
   *
   * The raw scope key is a JSON array of the caller's `projectId`/`userId`/`sessionId`, and these logs
   * are files that routinely get shipped to a log aggregator, so the raw key is never written. The
   * label matches the reason in Slack and Discord, so one pseudonym connects both surfaces.
   */
  scopeKey: string;
  estimatedCost: number;
  actualCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  candidateCount?: number;
  promptCount?: number;
  tokens: number;
  promptPreview?: string;
  state: {
    requestCount: number;
    blockedCount: number;
    reservedCost: number;
    totalCost: number;
    attemptedCost: number;
    blockedCost: number;
    actualCost: number;
  };
}

/**
 * Directories this process has already created for an event log.
 *
 * `mkdirSync(..., { recursive: true })` is a syscall on the guarded hot path: without this cache
 * every allowed request, every block, and every usage reconciliation paid for a directory creation
 * syscall that had already succeeded. Event logging is opt-in, so a process that enables it pays
 * the cost on every guarded call.
 */
const ensuredDirectories = new Set<string>();

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
    const directory = dirname(eventLogPath);
    if (!ensureDirectory(directory)) return;

    const line = JSON.stringify(toEventLogRecord(event, promptMode)) + '\n';
    try {
      appendFileSync(eventLogPath, line, 'utf8');
    } catch {
      // The directory was cached from an earlier write, so an append failure can mean something
      // outside this process removed or replaced it. Drop the cache entry and retry once, which
      // recovers the log instead of silently losing every event from here on.
      ensuredDirectories.delete(directory);
      if (!ensureDirectory(directory)) return;
      appendFileSync(eventLogPath, line, 'utf8');
      return;
    }
  } catch {
    // Event logs are local observability only and must not affect guard decisions.
  }
}

/**
 * Creates `directory` once per process, reporting whether it exists afterwards.
 */
function ensureDirectory(directory: string): boolean {
  if (ensuredDirectories.has(directory)) return true;

  try {
    mkdirSync(directory, { recursive: true });
    ensuredDirectories.add(directory);
    return true;
  } catch {
    return false;
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
    scopeKey: describeScope(event.context.scopeKey),
    estimatedCost: roundMoney(event.context.estimatedCost),
    actualCost: event.context.actualCost === undefined ? undefined : roundMoney(event.context.actualCost),
    inputTokens: event.context.inputTokens,
    outputTokens: event.context.outputTokens,
    candidateCount: event.context.candidateCount,
    promptCount: event.context.promptCount,
    tokens: event.context.tokens,
    state: {
      requestCount: event.state.requestCount,
      blockedCount: event.state.blockedCount,
      reservedCost: roundMoney(event.state.reservedCost),
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
