# Security Policy

## Supported Versions

Only the latest published version of `@salimassili/ai-costguard` receives security fixes.

## Reporting A Vulnerability

Please report vulnerabilities privately to the maintainer. Include:

- affected version
- reproduction steps
- expected and actual behavior
- impact assessment

Do not publish exploit details until a fix is available.

## Actual Security Model

AI CostGuard is an in-process pre-call guard. It does not run a proxy server, authenticate API keys, terminate TLS, store provider API keys, or provide a hosted control plane.

The root package:

- keeps prompt history in process memory for loop/retry detection
- sends no telemetry
- makes no network calls except optional Slack/Discord block webhooks configured by the application
- does not persist prompts to disk unless the application explicitly enables `eventLogPath` with `eventLogPrompt: 'preview'`
- does not mutate provider API keys

The optional Pro helper at `@salimassili/ai-costguard/pro` can connect to Redis when configured. Redis URL handling and network access are the host application's responsibility.

The local dashboard command reads an application-selected JSONL file and binds to `127.0.0.1` by default. It is not a hosted analytics product.

## Data Handling

Prompts used for behavior analysis are retained in process memory until evicted by `maxHistory` or `historyTtlMs`. Do not enable behavior analysis for data you are not allowed to retain even briefly in memory.

Webhook payloads include the block reason, model, and estimated cost. They do not include the full prompt by default.

JSONL event logs include model, method, scope key, estimated cost, event type, and block code. Prompt text is excluded by default. Prompt previews are written only when `eventLogPrompt: 'preview'` is configured.

## Known Limitations

- Cost checks are estimates, not provider billing records.
- Loop and retry detection are heuristics and can have false positives or false negatives.
- `licenseKey` and `validateLicense()` are compatibility helpers only. They do not enforce commercial access control.
- The free guard is process-local and does not protect other processes unless the application shares state externally.
