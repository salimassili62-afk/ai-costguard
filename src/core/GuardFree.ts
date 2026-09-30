import { GuardCore, GuardError, createGuardState } from './GuardCore.js';
import type { GuardConfig, GuardEventHandler, GuardEventName, GuardState, RequestContext } from './types.js';

/**
 * Event controls added to a guarded client proxy.
 */
export interface GuardEventControls {
  /** Subscribes to block, allow, cost, or usage events. */
  on(eventName: GuardEventName, handler: GuardEventHandler): () => void;
  /** Removes an event handler. */
  off(eventName: GuardEventName, handler: GuardEventHandler): void;
  /** Returns the mutable process-local guard state. */
  getGuardState(): GuardState;
}

/**
 * Client type returned by guard().
 */
export type GuardedClient<TClient extends object> = TClient & GuardEventControls;

/**
 * Wraps an OpenAI-like client with process-local cost, loop, and retry protection.
 */
export function guard<TClient extends object>(
  client: TClient,
  config: GuardConfig = {},
  sharedState: GuardState = createGuardState()
): GuardedClient<TClient> {
  const core = new GuardCore(config, sharedState);
  const proxies = new WeakMap<object, Map<string, object>>();

  const wrap = <TObject extends object>(target: TObject, path: string[] = []): TObject & GuardEventControls => {
    const cacheKey = JSON.stringify(path);
    const targetProxies = proxies.get(target) ?? new Map<string, object>();
    const cached = targetProxies.get(cacheKey);
    if (cached) return cached as TObject & GuardEventControls;

    const proxy = new Proxy(target, {
      get(currentTarget, prop, receiver) {
        // Only the root proxy carries the event controls. Intercepting these names at every nesting
        // depth would shadow a client method that happens to be called `on`, `off`, or
        // `getGuardState` (an EventEmitter-style client, for example), silently replacing it with
        // the guard's own subscription API.
        if (path.length === 0) {
          if (prop === 'on') return core.on.bind(core);
          if (prop === 'off') return core.off.bind(core);
          if (prop === 'getGuardState') return core.getState.bind(core);
        }

        const value = Reflect.get(currentTarget, prop, receiver) as unknown;
        const nextPath = typeof prop === 'string' ? [...path, prop] : path;

        if (typeof value === 'function') {
          return (...args: readonly unknown[]) => {
            const methodPath = nextPath.join('.');
            if (!core.shouldGuardMethod(methodPath)) {
              return Reflect.apply(value, currentTarget, args);
            }

            const context = core.extractContext(args, methodPath);
            core.check(context);
            const result = Reflect.apply(value, currentTarget, stripGuardMetadata(args));

            if (isPromiseLike(result)) {
              return result.then((resolved: unknown) => {
                core.recordActualUsage(context, resolved);
                return resolved;
              });
            }

            core.recordActualUsage(context, result);
            return result;
          };
        }

        if (isObject(value)) {
          return wrap(value, nextPath);
        }

        return value;
      },
    });

    targetProxies.set(cacheKey, proxy);
    proxies.set(target, targetProxies);
    return proxy as TObject & GuardEventControls;
  };

  return wrap(client);
}

/**
 * Wraps a standalone AI function with the same guard behavior as guard().
 *
 * The first function argument should be an OpenAI-like request object containing
 * model, messages/prompt/input, and max_tokens/maxOutputTokens when possible.
 */
export function guardFunction<TArgs extends readonly unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  config: GuardConfig = {}
): ((...args: TArgs) => TResult) & GuardEventControls {
  const methodName = config.guardedMethods?.[0] ?? 'run';
  // The function is parked one level down because the root proxy owns the `on`/`off`/
  // `getGuardState` controls. A method literally named `on` would otherwise be unreachable.
  const container = { fn: { [methodName]: fn } } as Record<string, Record<string, (...args: TArgs) => TResult>>;
  const guarded = guard(container, {
    ...config,
    guardedMethods: [`fn.${methodName}`],
  });
  const guardedFn = ((...args: TArgs) => guarded.fn[methodName](...args)) as ((...args: TArgs) => TResult) &
    GuardEventControls;

  guardedFn.on = guarded.on;
  guardedFn.off = guarded.off;
  guardedFn.getGuardState = guarded.getGuardState;

  return guardedFn;
}

/**
 * Express-compatible middleware that attaches req.localSafety.check() and req.guard.check().
 *
 * Prefer `checkRequest()` when the caller holds an OpenAI-like request object. It lets the guard
 * derive the cost itself, so the reported spend cannot be under-stated by the caller. `check()`
 * remains available for callers that already hold a `RequestContext` and have costed the request
 * through their own pipeline.
 */
export function middleware(config: GuardConfig = {}): (req: MiddlewareRequest, res: unknown, next: () => void) => void {
  const core = new GuardCore(config);

  return (req: MiddlewareRequest, _res: unknown, next: () => void) => {
    const controls: MiddlewareControls = {
      state: core.getState(),
      check: (context: RequestContext) => {
        core.check(context);
      },
      checkRequest: (request: unknown) => {
        core.check(core.extractContext([request]));
      },
      on: core.on.bind(core),
      off: core.off.bind(core),
    };

    req.localSafety = controls;
    req.guard = controls;
    next();
  };
}

/**
 * Error thrown when a request is blocked before provider execution.
 */
export { GuardError };

/**
 * Pricing lookup re-export kept for compatibility with older imports.
 */
export { getPricing } from '../pricing/index.js';

/**
 * Request object that `middleware()` attaches its controls to.
 */
export interface MiddlewareRequest {
  localSafety?: MiddlewareControls;
  guard?: MiddlewareControls;
}

/**
 * Per-request guard controls attached by `middleware()`.
 */
export interface MiddlewareControls {
  state: GuardState;
  /**
   * Evaluates a caller-built request context.
   *
   * The guard trusts `context.estimatedCost` exactly as supplied, so a caller that reports $0
   * reserves $0 and its budget never moves. Reach for this only when the context was produced by
   * the guard itself.
   */
  check(context: RequestContext): void;
  /**
   * Evaluates an OpenAI-like request object and costs it with the guard's own tokenizer and
   * pricing table. The estimate cannot be under-stated by the caller, so this is the safe default
   * for hand-rolled integrations.
   */
  checkRequest(request: unknown): void;
  on(eventName: GuardEventName, handler: GuardEventHandler): () => void;
  off(eventName: GuardEventName, handler: GuardEventHandler): void;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return isObject(value) && typeof (value as { then?: unknown }).then === 'function';
}

function stripGuardMetadata(args: readonly unknown[]): readonly unknown[] {
  const [first, ...rest] = args;
  if (!isPlainRecord(first)) return args;

  const {
    projectId: _projectId,
    project_id: _project_id,
    userId: _userId,
    user_id: _user_id,
    sessionId: _sessionId,
    session_id: _session_id,
    runId: _runId,
    run_id: _run_id,
    ...providerParams
  } = first;

  return [providerParams, ...rest];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}
