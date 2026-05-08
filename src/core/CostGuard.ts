/**
 * CostGuard.ts — AI Agent Loop & Cost Firewall
 *
 * Wraps your AI client and kills runaway loops before they burn money.
 * When it blocks, it tells you exactly how much it saved.
 */

import { CostGuardConfig, RequestContext, GuardState, GuardDecision } from './types.js';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
};

/**
 * Wraps any AI client. Detects loops. Enforces hard limits.
 * Throws on block so your app handles it.
 */
export function withCostGuard(client: any, config: any, sharedState?: GuardState) {
  const defaults: CostGuardConfig = {
    maxTokensPerRequest: 4000,
    maxRequestsPerMinute: 30,
    maxTotalCostPerDay: 10.00,
    loopDetection: true,
  };

  const guard = { ...defaults, ...config };
  // Use shared state if provided (for nested objects), otherwise create new
  const state: GuardState = sharedState || {
    requestCount: 0,
    totalCost: 0,
    lastRequestTime: 0,
    recentPrompts: [],
    blockedCount: 0,
  };

  return new Proxy(client, {
    get(target, prop) {
      const value = target[prop as string];

      // If it's a function (like .create), wrap it
      if (typeof value === 'function') {
        return (...args: any[]) => {
          // Extract request details from args
          const ctx = extractContext(args, prop as string);

          // Evaluate against limits
          const decision = evaluate(guard, state, ctx);

          if (decision === 'block') {
            state.blockedCount++;

            // Build a financial save message
            const saveMsg = buildSaveMessage(state, ctx);
            console.error(saveMsg);

            if (guard.onLimitHit) {
            guard.onLimitHit('Limit exceeded', ctx.estimatedCost);
          }
            throw new CostGuardError(
              saveMsg.replace('[AI CostGuard] ', ''),
              ctx
            );
          }

          // Update state
          state.requestCount++;
          state.totalCost += ctx.estimatedCost;
          state.lastRequestTime = Date.now();
          if (guard.loopDetection) state.recentPrompts.push(ctx.prompt);
          if (state.recentPrompts.length > 20) state.recentPrompts.shift();

          console.log(`[AI CostGuard] ALLOW: ${ctx.model} | ${ctx.tokens}t | $${ctx.estimatedCost.toFixed(4)} | Total: $${state.totalCost.toFixed(2)}`);

          // Pass through to actual API call
          return value.apply(target, args);
        };
      }

      // If it's a nested object (like .chat.completions), recurse with shared state
      if (value && typeof value === 'object') {
        return withCostGuard(value, guard, state);
      }

      return value;
    },
  });
}

/**
 * Standalone middleware for Express/Fastify
 */
export function costGuardMiddleware(config: Partial<CostGuardConfig> = {}) {
  const guard = {
    maxTokensPerRequest: 4000,
    maxRequestsPerMinute: 30,
    maxTotalCostPerDay: 10.00,
    loopDetection: true,
    ...config,
  };

  const state: GuardState = {
    requestCount: 0,
    totalCost: 0,
    lastRequestTime: 0,
    recentPrompts: [],
    blockedCount: 0,
  };

  return (req: any, res: any, next: any) => {
    req.costGuard = {
      state,
      evaluate: (ctx: RequestContext) => {
        const decision = evaluate(guard, state, ctx);
        if (decision === 'block') {
          state.blockedCount++;
          throw new CostGuardError('Request blocked by cost guard', ctx);
        }
        state.requestCount++;
        state.totalCost += ctx.estimatedCost;
        state.lastRequestTime = Date.now();
      },
    };
    next();
  };
}

/** Extract request context from API call args */
function extractContext(args: any[], prop: string): RequestContext {
  const params = args[0] || {};
  const model = params.model || 'unknown';
  const messages = params.messages || [];
  const prompt = messages.map((m: any) => m.content).join(' ').slice(0, 200);

  // Estimate tokens (rough: 1 token ≈ 4 chars for English)
  const inputText = JSON.stringify(messages);
  const estimatedInputTokens = Math.ceil(inputText.length / 4);
  const maxOutputTokens = params.max_tokens || 1000;
  const tokens = estimatedInputTokens + maxOutputTokens;

  // Estimate cost
  const pricing = MODEL_PRICING[model] || { input: 0.01, output: 0.03 };
  const estimatedCost = (estimatedInputTokens / 1000) * pricing.input +
                        (maxOutputTokens / 1000) * pricing.output;

  return {
    model,
    tokens,
    estimatedCost,
    timestamp: Date.now(),
    prompt,
  };
}

/** Build a human-readable "financial save" message */
function buildSaveMessage(state: GuardState, ctx: RequestContext): string {
  const duplicates = state.recentPrompts.filter(p => p === ctx.prompt).length;
  const isLoop = duplicates >= 2;

  // Estimate how much we saved by blocking this + projected future calls
  // Assume a runaway loop would repeat ~50 more times if unchecked
  const projectedCycles = isLoop ? 50 : 10;
  const estimatedSave = (ctx.estimatedCost * projectedCycles) + ctx.estimatedCost;

  if (isLoop) {
    return `[AI CostGuard] BLOCKED LOOP → ${duplicates + 1} recursive cycles detected → estimated save: $${estimatedSave.toFixed(2)}`;
  }

  if (ctx.tokens > 4000) {
    return `[AI CostGuard] BLOCKED TOKEN BOMB → ${ctx.tokens} tokens → estimated save: $${ctx.estimatedCost.toFixed(2)}`;
  }

  if (state.totalCost + ctx.estimatedCost > 5) {
    const remaining = (state.totalCost + ctx.estimatedCost) - 5;
    return `[AI CostGuard] BLOCKED BUDGET BREACH → daily cap reached → estimated save: $${remaining.toFixed(2)}`;
  }

  return `[AI CostGuard] BLOCKED → estimated save: $${ctx.estimatedCost.toFixed(2)}`;
}

/** Evaluate request against all limits */
function evaluate(guard: CostGuardConfig, state: GuardState, ctx: RequestContext): GuardDecision {
  // 1. Token limit
  if (ctx.tokens > guard.maxTokensPerRequest) {
    return 'block';
  }

  // 2. RPM limit
  const oneMinuteAgo = Date.now() - 60000;
  if (state.lastRequestTime > oneMinuteAgo && state.requestCount >= guard.maxRequestsPerMinute) {
    return 'block';
  }

  // 3. Daily cost limit
  if (state.totalCost + ctx.estimatedCost > guard.maxTotalCostPerDay) {
    return 'block';
  }

  // 4. Loop detection (simple: same prompt repeated)
  if (guard.loopDetection && state.recentPrompts.length > 0) {
    const duplicates = state.recentPrompts.filter(p => p === ctx.prompt).length;
    if (duplicates >= 2) {
      return 'block';
    }
  }

  return 'allow';
}

/** Custom error so users can catch it specifically */
export class CostGuardError extends Error {
  context: RequestContext;
  constructor(message: string, context: RequestContext) {
    super(message);
    this.name = 'CostGuardError';
    this.context = context;
  }
}

/** Get current pricing for a model (cents per 1K tokens) */
export function getPricing(model: string): { input: number; output: number } | undefined {
  return MODEL_PRICING[model];
}
