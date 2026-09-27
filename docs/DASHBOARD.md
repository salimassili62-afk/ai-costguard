# Local Dashboard

AI CostGuard includes a local-only dashboard command. It does not create an account, send telemetry, or run a cloud backend.

The dashboard reads a JSONL event log written by guarded clients:

```ts
import { guard } from '@salimassili/ai-costguard';

const openai = guard(client, {
  budget: 5,
  eventLogPath: '.ai-costguard/events.jsonl',
  eventLogPrompt: 'none',
});
```

The server binds to `127.0.0.1` by default. Non-loopback binding is refused unless the caller explicitly opts in with `allowRemote: true` or the CLI `--allow-remote` flag. The dashboard has no authentication, so do not expose it to an untrusted network.

Start the dashboard:

```bash
ai-costguard dashboard --events .ai-costguard/events.jsonl --budget 5
```

For scoped packages or one-off runs:

```bash
npx @salimassili/ai-costguard dashboard --events .ai-costguard/events.jsonl --budget 5
```

If the package is installed locally, this also works:

```bash
npx ai-costguard dashboard --events .ai-costguard/events.jsonl --budget 5
```

## What It Shows

- Budget used
- Requests allowed
- Requests blocked
- Estimated spend
- Estimated savings
- Attempted spend
- Actual spend when provider usage is available
- Loop detections
- Retry detections
- Recent guard events

## Non-Interactive Summary

Use `--once` for CI, smoke tests, or terminal summaries:

```bash
ai-costguard dashboard --events .ai-costguard/events.jsonl --budget 5 --once
ai-costguard dashboard --events .ai-costguard/events.jsonl --budget 5 --once --json
```

## Operational Caveats

The event log is a debugging and local-reporting tool, not a production log pipeline. Before pointing it at a long-lived process, know all three of these:

- **Writes are synchronous and on the guarded call path.** Each guard event that gets logged costs one `mkdirSync` and one `appendFileSync` before the call returns. This is the dominant per-call cost of enabling `eventLogPath`, and it is included in no published benchmark. It is fine for local development; it is not fine on a hot production path.
- **The log never rotates and never truncates.** `events.jsonl` grows without bound for the life of the process. The library does not delete, cap, or prune it. Add your own rotation (logrotate, a sidecar, a scheduled job) if you leave it enabled for more than a local session.
- **The dashboard re-reads and re-parses the entire file on every request.** Each page load or `/events.json` fetch reopens the log, re-parses every line, and re-validates every record from scratch. Cost is linear in file size, so a large log makes the dashboard progressively slower. Unparseable lines are skipped, not fatal.

A write failure (unwritable directory, full disk, bad path) is swallowed: logging is observability only, so it can never fail or delay a guard decision in any way the caller can observe. A *read* failure, by contrast, is reported: the request returns HTTP 500 with the offending path rather than taking the process down.

## Privacy Notes

`eventLogPrompt` defaults to `none`, so prompt text is not written to disk. Set `eventLogPrompt: 'preview'` only for local debugging where prompt previews are acceptable.

The dashboard is a local development view, not a billing ledger. Use provider billing exports for financial reconciliation.

Actual spend comes from `usage` events written after successful provider responses expose recognizable `usage` fields.
