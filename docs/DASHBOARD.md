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

The server binds to `127.0.0.1` by default and needs no configuration for local use. The dashboard shows
your event log, so any binding beyond loopback is both opt-in and authenticated:

- Non-loopback binding is refused unless the caller passes `allowRemote: true` (CLI `--allow-remote`).
- Non-loopback binding is refused **without an auth token**. The token must be at least 16 characters.
- On loopback, setting a token also turns authentication on; without one, localhost stays open.

Supply the token with the `COSTGUARD_DASHBOARD_TOKEN` environment variable (preferred),
`authToken: '<secret>'` (API), or `--auth-token <secret>` (CLI). Prefer the environment variable: a
command-line flag is visible in shell history and the process list on shared machines.

The token is **never accepted in a URL.** A query string is written to browser history, sent to other
origins in the `Referer` header, and recorded by every proxy and access log along the way, so a
`?token=` login would leak the secret. Instead:

- **Browsers** sign in at `/login`, a public page whose form POSTs the token in the request body. On
  success the server sets an `HttpOnly`, `SameSite=Strict` cookie and redirects to `/`. The secret
  never appears in a URL, a redirect target, or the page itself. Repeated wrong guesses from one
  connection are throttled (`429` with `Retry-After`) so the shared secret cannot be brute-forced
  without bound.
- **Scripts and `curl`** send the token as `Authorization: Bearer <token>` or an
  `X-CostGuard-Token: <token>` header.

Every response carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and
`X-Content-Type-Options: nosniff`.

### Remote access requires an encrypted transport

The dashboard speaks **plain HTTP**. Serving it beyond loopback is only supported behind an encrypted
transport — a TLS-terminating reverse proxy or an SSH port-forward. Without TLS the token and the
login cookie cross the network in cleartext, so remote HTTP access is not secure and is not supported.

When TLS is terminated in front of the dashboard, add the `Secure` attribute to the login cookie with
`--cookie-secure` (or `COSTGUARD_DASHBOARD_COOKIE_SECURE=1`). The flag is opt-in on purpose: the
dashboard does **not** read `X-Forwarded-Proto` or any other forwarded header to decide this, because
any client can send those headers. The cookie is marked `Secure` automatically only when the request
itself arrived over TLS, which does not happen for this plain-HTTP server. (Without `Secure`, a browser
may still send the cookie over a downgraded HTTP request.)

The login throttle is keyed by the connection's remote address, never by a forwarded client-IP header.
Behind a reverse proxy that means every client shares the proxy's address and one bucket; that is a
deliberate trade-off, since trusting a forwarded IP would let an attacker forge it.

```bash
# Local, no token needed
ai-costguard dashboard --events .ai-costguard/events.jsonl --budget 5

# Remote, token required; terminate TLS in front, then sign in at https://<host>:<port>/login
export COSTGUARD_DASHBOARD_TOKEN="$(openssl rand -hex 24)"
export COSTGUARD_DASHBOARD_COOKIE_SECURE=1
ai-costguard dashboard --events .ai-costguard/events.jsonl --host 0.0.0.0 --allow-remote

# Script access with a header instead of the cookie
curl -H "Authorization: Bearer $COSTGUARD_DASHBOARD_TOKEN" http://127.0.0.1:4318/events.json
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

## Operational Caveats

The event log is a debugging and local-reporting tool, not a production log pipeline. Before pointing it at a long-lived process, know all three of these:

- **Writes are synchronous and on the guarded call path.** Each guard event that gets logged costs one `appendFileSync` before the call returns; the containing directory is created once and cached for the life of the process, so the `mkdirSync` syscall is not paid per event. The append is the dominant per-call cost of enabling `eventLogPath`, and it is included in no published benchmark. It is fine for local development; it is not fine on a hot production path.
- **The log never rotates and never truncates.** `events.jsonl` grows without bound for the life of the process. The library does not delete, cap, or prune it. Add your own rotation (logrotate, a sidecar, a scheduled job) if you leave it enabled for more than a local session.
- **The dashboard re-parses the log when it changes, not on every request.** Parsed events are cached and reused while the file's size and mtime are unchanged, so repeated page loads or `/events.json` polls against a static log are cheap. Once the log grows, the file is re-read and re-parsed from scratch, and that cost is linear in file size, so a large log makes each update progressively slower. Unparseable lines are skipped, not fatal.

A write failure (unwritable directory, full disk, bad path) is swallowed: logging is observability only, so it can never fail or delay a guard decision in any way the caller can observe. A *read* failure, by contrast, is reported: the request returns HTTP 500 with the offending path rather than taking the process down.

## Privacy Notes

`eventLogPrompt` defaults to `none`, so prompt text is not written to disk. Set `eventLogPrompt: 'preview'` only for local debugging where prompt previews are acceptable.

The dashboard is a local development view, not a billing ledger. Use provider billing exports for financial reconciliation.

Actual spend comes from `usage` events written after successful provider responses expose recognizable `usage` fields.
