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

The optional shared-budget helper at `@salimassili/ai-costguard/pro` can connect to Redis when
configured. Redis URL handling and network access are the host application's responsibility. It fails
closed when Redis is unreachable: every call throws `SHARED_BUDGET_UNAVAILABLE` rather than silently
degrading to a per-process budget. The `allowLocalFallback: true` opt-out is a documented,
deliberate weakening of that guarantee, not a safe default.

The local dashboard command reads an application-selected JSONL file and binds to `127.0.0.1` by default. Non-loopback binding requires explicit opt-in and has no authentication. It is not a hosted analytics product.

## Data Handling

Prompts used for behavior analysis are retained in process memory until evicted by `maxHistory` or `historyTtlMs`. Do not enable behavior analysis for data you are not allowed to retain even briefly in memory.

Webhook payloads include the block reason, model, and estimated cost. They do not include the full prompt by default.

JSONL event logs include model, method, scope key, estimated/reserved cost, event type, and block code. Scope identifiers can contain tenant or user data and should be treated as sensitive. Prompt text is excluded by default. Prompt previews are written only when `eventLogPrompt: 'preview'` is configured.

The package has no runtime dependencies, makes no network request unless you configure a webhook
URL, and contains no license check, activation logic, or telemetry. `test/smoke-examples.mjs` and
`scripts/package-smoke.js` both assert that the shipped artifact stays free of payment and license
gates, so a regression there fails CI rather than reaching a user.

## Known Limitations

- Cost checks are estimates, not provider billing records.
- Loop and retry detection are heuristics and can have false positives or false negatives.
- Built-in pricing is a dated snapshot and goes stale; it is disclosed at startup, not hidden.
- AI CostGuard is not a hard security boundary, an access-control system, or a substitute for
  provider-side spend limits. Use provider budgets as a second, independent layer.
- The guard is process-local and does not protect other processes unless the application shares state
  externally, either through a shared `GuardState` in one address space or a shared store via `/pro`.
