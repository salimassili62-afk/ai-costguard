import { createHash, randomBytes } from 'node:crypto';

/**
 * Per-process salt for scope fingerprints.
 *
 * A fixed salt would make the fingerprints a stable, offline-reversible encoding of user and session
 * identifiers: anyone holding a list of candidate identifiers and the logs could confirm which one a
 * label belongs to. A per-process random salt means a log or a Slack message only identifies a scope
 * within the process that produced it, which is all the block reason and the dashboard need.
 */
const SCOPE_FINGERPRINT_SALT = randomBytes(16);

/**
 * Returns a short, stable, non-reversible label for a scope key.
 *
 * A scope key is a JSON array of the caller's own `projectId`, `userId`, `sessionId`, and `runId`, for
 * example `[null,"alice@example.com",null,null]`. It is the identifier the guard uses to isolate
 * budgets, so it has to be exact, and it is therefore unusable anywhere the text can be read by
 * someone who is not the operator: block reasons are posted verbatim to Slack and Discord, and the
 * event log is a file that routinely ends up shipped to a log aggregator.
 *
 * Both surfaces use this same label so an operator can match a Slack block to the matching local
 * record without either of them carrying an email address. Fingerprints are stable within a process
 * and deliberately not stable across restarts, so the label is not a durable identifier.
 */
export function describeScope(scopeKey: string | undefined): string {
  if (!scopeKey || scopeKey === 'default') return 'default';
  const digest = createHash('sha256').update(SCOPE_FINGERPRINT_SALT).update(scopeKey).digest('hex');
  return `scope#${digest.slice(0, 8)}`;
}
