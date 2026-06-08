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

## Privacy Notes

`eventLogPrompt` defaults to `none`, so prompt text is not written to disk. Set `eventLogPrompt: 'preview'` only for local debugging where prompt previews are acceptable.

The dashboard is a local development view, not a billing ledger. Use provider billing exports for financial reconciliation.
