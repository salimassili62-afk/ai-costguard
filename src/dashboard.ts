import { timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { GuardErrorCode, GuardEventName } from './core/types.js';

const DEFAULT_EVENT_LOG_PATH = '.ai-costguard/events.jsonl';
const DEFAULT_DASHBOARD_HOST = '127.0.0.1';
const DEFAULT_DASHBOARD_PORT = 4318;

/**
 * Minimum length accepted for a dashboard auth token.
 *
 * The dashboard exposes every event in the log, and a short low-entropy secret is trivially
 * brute-forced over HTTP, so the server refuses to start with anything shorter than this rather than
 * presenting a weak secret as authentication.
 */
const MIN_AUTH_TOKEN_LENGTH = 16;

/** Cookie set by the login form so the browser carries the token without it appearing in a URL. */
const DASHBOARD_AUTH_COOKIE = 'costguard_dashboard_token';

/** Public login endpoint. The only route that is reachable without a token. */
const DASHBOARD_LOGIN_PATH = '/login';

/** Maximum accepted login body size. A token is tiny; anything larger is a mistake or an attack. */
const MAX_LOGIN_BODY_BYTES = 4 * 1024;

/**
 * Failed login attempts tolerated from one remote address per window before `/login` answers 429.
 *
 * The token is a shared secret, so unbounded guessing is the one brute-force path the dashboard has.
 * Ten attempts a minute is far more than a person needs and far less than a script does; a
 * 16-character token is not reachable at that rate.
 */
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;

/** Length of the login rate-limit window, in milliseconds. */
const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Upper bound on tracked login buckets.
 *
 * Buckets are keyed by the connection's remote address, which an attacker cannot forge, but a
 * distributed source could still present many addresses. The map is pruned on write and hard-capped
 * here so a flood cannot grow it without limit.
 */
const LOGIN_RATE_LIMIT_MAX_ENTRIES = 10_000;

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
  /** Required when binding anywhere other than loopback. */
  allowRemote?: boolean;
  /**
   * Shared secret that gates every dashboard request.
   *
   * When `host` is not loopback this is **required**: the server refuses to bind to a non-loopback
   * address without it, because the dashboard can read the event log and has no other access
   * control. On loopback, setting a token also turns authentication on. Must be at least
   * {@link MIN_AUTH_TOKEN_LENGTH} characters.
   *
   * The token is never accepted in a URL. A browser authenticates through the login form at
   * `/login`, which exchanges the token (sent in a POST body) for an HttpOnly, SameSite=Strict
   * cookie. Scripts and `curl` may send the token as `Authorization: Bearer <token>` or an
   * `X-CostGuard-Token` header instead.
   */
  authToken?: string;
  /**
   * Marks the login cookie `Secure`.
   *
   * Set this whenever the dashboard is reached over HTTPS, including when TLS is terminated by a
   * reverse proxy in front of this plain-HTTP server — that is the supported way to serve the
   * dashboard remotely. When unset, the cookie is marked `Secure` only if the request itself arrived
   * over TLS, which never happens for this server directly, so an HTTPS deployment must opt in.
   *
   * Forwarded headers such as `X-Forwarded-Proto` are deliberately **not** consulted: any client can
   * send them, so they cannot be allowed to decide a cookie's security attribute.
   */
  cookieSecure?: boolean;
}

/**
 * Returns the default local event log path.
 */
export function getDefaultEventLogPath(): string {
  return DEFAULT_EVENT_LOG_PATH;
}

/**
 * Parsed events for one log file, reused while the file itself is unchanged.
 *
 * The dashboard is polled, and every poll used to re-read and re-parse the whole JSONL file
 * synchronously on the request path. On a busy guard that is thousands of JSON.parse calls per
 * request, all of it blocking the event loop of the application the dashboard was started from. The
 * log is append-only, so its size and mtime identify its contents well enough to reuse a parse: any
 * append or rewrite changes both.
 */
let parsedLog: { path: string; size: number; mtimeMs: number; events: DashboardEvent[] } | undefined;

/**
 * Reads dashboard events from a local JSONL event log.
 */
export function readDashboardEvents(eventLogPath = DEFAULT_EVENT_LOG_PATH): DashboardEvent[] {
  let stats;
  try {
    stats = statSync(eventLogPath);
  } catch {
    parsedLog = undefined;
    return [];
  }

  // A path that exists but is not a readable file is a misconfiguration, and it throws so the server
  // reports it. Returning an empty summary instead would render a dashboard that looks like a quiet
  // day right after the operator pointed it at the wrong file.
  if (!stats.isFile()) {
    throw new Error(`Event log path is not a readable file: ${eventLogPath}`);
  }

  if (
    parsedLog &&
    parsedLog.path === eventLogPath &&
    parsedLog.size === stats.size &&
    parsedLog.mtimeMs === stats.mtimeMs
  ) {
    // A copy, so a caller that mutates the result cannot poison the cache for the next poll.
    return parsedLog.events.slice();
  }

  const lines = readFileSync(eventLogPath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const events: DashboardEvent[] = [];
  for (const line of lines) {
    const event = parseDashboardEvent(line);
    if (event) events.push(event);
  }

  parsedLog = { path: eventLogPath, size: stats.size, mtimeMs: stats.mtimeMs, events };
  return events.slice();
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
  const authToken = typeof options.authToken === 'string' && options.authToken.trim() ? options.authToken.trim() : undefined;
  const remote = !isLoopbackHost(host);

  if (authToken !== undefined && authToken.length < MIN_AUTH_TOKEN_LENGTH) {
    return Promise.reject(
      new Error(`Dashboard authToken must be at least ${MIN_AUTH_TOKEN_LENGTH} characters; received ${authToken.length}.`)
    );
  }

  if (remote && options.allowRemote !== true) {
    return Promise.reject(
      new Error(
        'Refusing non-loopback dashboard binding without allowRemote: true. The dashboard can read your ' +
          'event log, so any binding beyond loopback is explicit.'
      )
    );
  }

  if (remote && authToken === undefined) {
    return Promise.reject(
      new Error(
        'Refusing non-loopback dashboard binding without authentication. Set authToken (CLI --auth-token, ' +
          `or COSTGUARD_DASHBOARD_TOKEN) to a secret of at least ${MIN_AUTH_TOKEN_LENGTH} characters, or keep ` +
          'the default loopback host.'
      )
    );
  }

  const requireAuth = authToken !== undefined;
  const cookieSecure = options.cookieSecure === true;
  const loginRateLimiter = createLoginRateLimiter();
  const server = createServer((request, response) => {
    if (requireAuth && authToken !== undefined) {
      // The login endpoint is the only unauthenticated route. It must never accept the token in the
      // URL: a token in a query string leaks through browser history, the Referer header, and every
      // proxy or access log on the way. The form POSTs the secret in the body instead.
      if (readPath(request.url) === DASHBOARD_LOGIN_PATH) {
        handleDashboardLogin(request, response, authToken, loginRateLimiter, cookieSecure);
        return;
      }

      const provided = extractRequestToken(request);
      if (provided === undefined || !tokensMatch(provided, authToken)) {
        // Send a browser navigation to the login form; keep programmatic callers on a plain 401 so a
        // JSON client is not handed an HTML page.
        if (isBrowserNavigation(request)) {
          response.writeHead(303, withSecurityHeaders({ location: DASHBOARD_LOGIN_PATH, 'cache-control': 'no-store' }));
          response.end();
          return;
        }

        respondUnauthorized(response);
        return;
      }
    }

    // An exception escaping this handler is an uncaughtException that kills the whole process,
    // including the guarded application this dashboard was started from. A dashboard is
    // observability only, so a bad log file or a rendering surprise becomes a 500, not a crash.
    let summary: DashboardSummary;
    try {
      summary = summarizeDashboard(options);
    } catch {
      response.writeHead(500, withSecurityHeaders({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }));
      response.end(`Could not read the event log at ${options.eventLogPath ?? DEFAULT_EVENT_LOG_PATH}.\n`);
      return;
    }

    if (isJsonRoute(request.url)) {
      response.writeHead(200, withSecurityHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }));
      response.end(JSON.stringify(summary, null, 2));
      return;
    }

    try {
      response.writeHead(200, withSecurityHeaders({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }));
      response.end(renderDashboardHtml(summary));
    } catch {
      response.writeHead(500, withSecurityHeaders({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }));
      response.end('Could not render the dashboard.\n');
    }
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

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Extracts a presented dashboard token from a request.
 *
 * Only headers and the login cookie are consulted. The token is deliberately **never** read from the
 * URL: a query string is written to browser history, sent to other origins in `Referer`, and logged
 * by every proxy and web server between the browser and the dashboard.
 */
function extractRequestToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/iu.exec(authorization.trim());
    if (match) return match[1];
  }

  const headerToken = request.headers['x-costguard-token'];
  if (typeof headerToken === 'string' && headerToken.length > 0) return headerToken;

  const cookie = request.headers.cookie;
  if (typeof cookie === 'string') {
    const value = readCookie(cookie, DASHBOARD_AUTH_COOKIE);
    if (value !== undefined) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return undefined;
}

/**
 * Reads one cookie value from a `Cookie` header.
 */
function readCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/**
 * Handles the public login endpoint.
 *
 * `GET` serves the form; `POST` reads the token from the body, and on success sets the auth cookie
 * and redirects to the dashboard root. A redirect target is a fixed constant, never a caller-supplied
 * value, so this cannot be used as an open redirect. Failed attempts are counted per remote address
 * and throttled so the shared secret cannot be guessed without bound.
 */
function handleDashboardLogin(
  request: IncomingMessage,
  response: ServerResponse,
  expected: string,
  rateLimiter: LoginRateLimiter,
  cookieSecure: boolean
): void {
  const method = (request.method ?? 'GET').toUpperCase();

  if (method === 'GET' || method === 'HEAD') {
    response.writeHead(200, withSecurityHeaders({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }));
    response.end(method === 'HEAD' ? undefined : renderLoginPage());
    return;
  }

  if (method !== 'POST') {
    response.writeHead(
      405,
      withSecurityHeaders({ allow: 'GET, POST', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    );
    response.end('Method Not Allowed\n');
    return;
  }

  const clientKey = remoteAddressKey(request);
  const retryAfterSeconds = rateLimiter.check(clientKey);
  if (retryAfterSeconds !== undefined) {
    response.writeHead(
      429,
      withSecurityHeaders({
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': String(retryAfterSeconds),
      })
    );
    response.end('Too many login attempts. Try again later.\n');
    return;
  }

  void readLoginToken(request)
    .then((token) => {
      if (token === undefined || !tokensMatch(token, expected)) {
        rateLimiter.recordFailure(clientKey);
        response.writeHead(
          401,
          withSecurityHeaders({
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'www-authenticate': 'Bearer',
          })
        );
        response.end(renderLoginPage('Invalid token.'));
        return;
      }

      rateLimiter.clear(clientKey);
      response.writeHead(
        303,
        withSecurityHeaders({
          location: '/',
          'set-cookie': `${DASHBOARD_AUTH_COOKIE}=${encodeURIComponent(expected)}; HttpOnly; SameSite=Strict; Path=/${
            isEncryptedRequest(request) || cookieSecure ? '; Secure' : ''
          }`,
          'cache-control': 'no-store',
        })
      );
      response.end();
    })
    .catch(() => {
      if (response.headersSent) return;
      response.writeHead(413, withSecurityHeaders({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }));
      response.end('Login request body is too large.\n');
    });
}

/**
 * Reads the `token` field from a login POST body.
 *
 * The body is drained to completion so the socket is not left half-read, but only bytes up to the
 * cap are buffered; a larger body is rejected rather than held in memory. The submitted value is
 * never reflected anywhere.
 */
function readLoginToken(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_LOGIN_BODY_BYTES) {
        overflow = true;
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (overflow) {
        reject(new Error('login body too large'));
        return;
      }

      const body = Buffer.concat(chunks).toString('utf8');
      const contentType = String(request.headers['content-type'] ?? '');

      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(body) as { token?: unknown };
          resolve(typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : undefined);
        } catch {
          resolve(undefined);
        }
        return;
      }

      const token = new URLSearchParams(body).get('token');
      resolve(token && token.length > 0 ? token : undefined);
    });

    request.on('error', reject);
  });
}

/**
 * Per-remote-address throttle for the login endpoint.
 */
interface LoginRateLimiter {
  /** Returns seconds to wait before retrying when the caller is over the limit, otherwise undefined. */
  check(key: string): number | undefined;
  /** Records one failed attempt. */
  recordFailure(key: string): void;
  /** Clears the counter for a key after a successful login. */
  clear(key: string): void;
}

/**
 * Creates a bounded, in-memory fixed-window login limiter.
 *
 * It is keyed by the caller-supplied address, which must be the connection's own remote address:
 * forwarded headers like `X-Forwarded-For` are attacker-controlled and are never consulted. The
 * bucket map is pruned as it is written and hard-capped, so a flood of distinct addresses cannot grow
 * it without bound. State is per-server, so one dashboard cannot exhaust another's budget.
 */
function createLoginRateLimiter(): LoginRateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function pruneExpired(now: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    check(key: string): number | undefined {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) return undefined;
      if (bucket.count < LOGIN_RATE_LIMIT_MAX_ATTEMPTS) return undefined;
      return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    },
    recordFailure(key: string): void {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        pruneExpired(now);
        if (buckets.size >= LOGIN_RATE_LIMIT_MAX_ENTRIES) {
          // Evict the oldest tracked address so the cap holds even under a distributed flood.
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined) buckets.delete(oldest);
        }
        buckets.set(key, { count: 1, resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS });
        return;
      }
      bucket.count += 1;
    },
    clear(key: string): void {
      buckets.delete(key);
    },
  };
}

/**
 * Returns the login rate-limit key for a request.
 *
 * The connection's remote address is used directly; no header is trusted, because a client can set
 * any of them. Behind a reverse proxy every client therefore shares the proxy's address and a single
 * bucket — an acknowledged limitation, not a reason to trust a spoofable header.
 */
function remoteAddressKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
}

/**
 * True when the request arrived over a TLS connection.
 *
 * This server speaks plain HTTP, so this is normally false; it exists so a directly TLS-wrapped
 * deployment still receives a `Secure` cookie without any header being trusted. A proxy-terminated
 * deployment sets `cookieSecure` explicitly instead.
 */
function isEncryptedRequest(request: IncomingMessage): boolean {
  return (request.socket as { encrypted?: boolean }).encrypted === true;
}

/**
 * True for a top-level browser navigation to the dashboard root.
 *
 * Only the root redirects to the login form. Everything else (the JSON route, non-GET methods) gets a
 * plain 401 so an API client is not silently handed an HTML page.
 */
function isBrowserNavigation(request: IncomingMessage): boolean {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  return readPath(request.url) === '/';
}

/**
 * Returns the request path, ignoring the query string and fragment.
 */
function readPath(url: string | undefined): string {
  if (!url) return '/';
  const path = url.split(/[?#]/u, 1)[0];
  return path.length > 0 ? path : '/';
}

/**
 * Adds the security headers every dashboard response carries.
 *
 * `Referrer-Policy: no-referrer` keeps the dashboard URL (and anything a caller might append to it)
 * out of a downstream origin's logs; `X-Content-Type-Options: nosniff` stops a browser from
 * reinterpreting a response body.
 */
function withSecurityHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  };
}

/**
 * Rejects a request that presented no valid token.
 */
function respondUnauthorized(response: ServerResponse): void {
  response.writeHead(
    401,
    withSecurityHeaders({
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'www-authenticate': 'Bearer',
    })
  );
  response.end('Unauthorized: a valid dashboard token is required. Authenticate at /login.\n');
}

/**
 * Renders the login form. The submitted token is never echoed back, only a fixed error message.
 */
function renderLoginPage(errorMessage?: string): string {
  const error = errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>AI CostGuard Dashboard Login</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101418; color: #eef2f4; }
    main { max-width: 360px; margin: 10vh auto; padding: 32px 24px; background: #161c22; border: 1px solid #2d363e; border-radius: 10px; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { color: #a8b3bd; font-size: 14px; }
    .error { color: #fca5a5; }
    label { display: block; margin: 16px 0 6px; font-size: 13px; color: #8d99a5; }
    input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid #2d363e; background: #0f1418; color: #eef2f4; font-size: 14px; }
    button { margin-top: 18px; width: 100%; padding: 10px; border: 0; border-radius: 6px; background: #16a34a; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>AI CostGuard Dashboard</h1>
    <p>Enter the dashboard token to continue.</p>
    ${error}
    <form method="post" action="/login">
      <label for="token">Dashboard token</label>
      <input id="token" name="token" type="password" autocomplete="off" required autofocus>
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
}

/**
 * Compares two tokens without an early-exit timing signal.
 *
 * `crypto.timingSafeEqual` requires equal-length buffers, so a length mismatch is compared against
 * itself before being rejected; the only thing that can leak is the expected token's length, which
 * is not the secret.
 */
function tokensMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(providedBuffer, providedBuffer);
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Matches the JSON summary route exactly, ignoring the query string.
 *
 * A `startsWith` test also answered `/events.json.bak`, `/events.jsonl`, and `/events.jsonfoo` with
 * raw JSON, which is both wrong and an easy way to leak the summary to a link that was meant to be a
 * page.
 */
function isJsonRoute(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split(/[?#]/u, 1)[0];
  return path === '/events.json';
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

/**
 * Validates one JSONL line into a dashboard event.
 *
 * Every field the renderer dereferences is type-checked here, not downstream. The renderer calls
 * `String.prototype.replaceAll` and `Number.prototype.toFixed` on these values, and a log file can
 * be hand-edited, truncated, or produced by an older version, so a single line with a number where
 * a string belongs would otherwise throw inside the request handler and take the whole process
 * down. Anything that does not match the documented shape is skipped instead.
 */
function parseDashboardEvent(line: string): DashboardEvent | undefined {
  let value: Partial<DashboardEvent>;
  try {
    value = JSON.parse(line) as Partial<DashboardEvent>;
  } catch {
    return undefined;
  }

  if (value === null || typeof value !== 'object') return undefined;
  if (value.version !== 1) return undefined;
  if (!isNonEmptyString(value.timestamp)) return undefined;
  if (!isGuardEventName(value.type)) return undefined;
  if (!isNonEmptyString(value.model)) return undefined;
  if (!isNonEmptyString(value.scopeKey)) return undefined;
  if (!isFiniteNumber(value.estimatedCost) || value.estimatedCost < 0) return undefined;
  if (!isFiniteNumber(value.tokens) || value.tokens < 0) return undefined;
  if (value.code !== undefined && !isNonEmptyString(value.code)) return undefined;
  if (value.reason !== undefined && typeof value.reason !== 'string') return undefined;
  if (value.method !== undefined && typeof value.method !== 'string') return undefined;
  if (value.actualCost !== undefined && (!isFiniteNumber(value.actualCost) || value.actualCost < 0)) return undefined;
  if (value.inputTokens !== undefined && (!isFiniteNumber(value.inputTokens) || value.inputTokens < 0)) return undefined;
  if (value.outputTokens !== undefined && (!isFiniteNumber(value.outputTokens) || value.outputTokens < 0)) return undefined;
  if (value.promptPreview !== undefined && typeof value.promptPreview !== 'string') return undefined;

  return value as DashboardEvent;
}

const GUARD_EVENT_NAMES: readonly string[] = ['block', 'allow', 'cost', 'usage'];

function isGuardEventName(value: unknown): value is GuardEventName {
  return typeof value === 'string' && GUARD_EVENT_NAMES.includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
