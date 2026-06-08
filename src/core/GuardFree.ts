import { GuardCore, GuardError, createGuardState } from './GuardCore.js';
import type { GuardConfig, GuardEventHandler, GuardEventName, GuardState, RequestContext } from './types.js';

/**
 * Event controls added to a guarded client proxy.
 */
export interface GuardEventControls {
  /** Subscribes to block, allow, or cost events. */
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
  const proxies = new WeakMap<object, object>();

  const wrap = <TObject extends object>(target: TObject, path: string[] = []): TObject & GuardEventControls => {
    const cached = proxies.get(target);
    if (cached) return cached as TObject & GuardEventControls;

    const proxy = new Proxy(target, {
      get(currentTarget, prop, receiver) {
        if (prop === 'on') return core.on.bind(core);
        if (prop === 'off') return core.off.bind(core);
        if (prop === 'getGuardState') return core.getState.bind(core);

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

    proxies.set(target, proxy);
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
  const container = { [methodName]: fn } as Record<string, (...args: TArgs) => TResult>;
  const guarded = guard(container, {
    ...config,
    guardedMethods: [methodName],
  });
  const guardedFn = ((...args: TArgs) => guarded[methodName](...args)) as ((...args: TArgs) => TResult) &
    GuardEventControls;

  guardedFn.on = guarded.on;
  guardedFn.off = guarded.off;
  guardedFn.getGuardState = guarded.getGuardState;

  return guardedFn;
}

/**
 * Express-compatible middleware that attaches req.localSafety.check() and req.guard.check().
 */
export function middleware(config: GuardConfig = {}): (req: MiddlewareRequest, res: unknown, next: () => void) => void {
  const core = new GuardCore(config);

  return (req: MiddlewareRequest, _res: unknown, next: () => void) => {
    const controls = {
      state: core.getState(),
      check: (context: RequestContext) => {
        core.check(context);
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

interface MiddlewareRequest {
  localSafety?: MiddlewareControls;
  guard?: MiddlewareControls;
}

interface MiddlewareControls {
  state: GuardState;
  check(context: RequestContext): void;
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
    ...providerParams
  } = first;

  return [providerParams, ...rest];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}
