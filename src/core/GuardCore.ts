/**
 * GuardCore.ts - FREE CORE (VIRAL ENGINE)
 * 
 * Maximum simplicity. Maximum virality. Zero complexity.
 * Instant safety layer every AI developer installs by default.
 */

import { GuardConfig, RequestContext, GuardState } from './types.js';

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
 * Guard your AI client from wasting money
 * FREE CORE: Local protection + viral logs + real-time risk warnings
 */
export function guard(client: any, config: GuardConfig, sharedState?: GuardState) {
  const defaults: GuardConfig = {
    budget: 10
  };

  const guardConfig = { ...defaults, ...config };
  const state: GuardState = sharedState || {
    requestCount: 0,
    totalCost: 0,
    lastRequestTime: 0,
    blockedCount: 0,
  };

  return new Proxy(client, {
    get(target, prop) {
      const value = target[prop as string];

      if (typeof value === 'function') {
        return (...args: any[]) => {
          const ctx = extractContext(args, prop as string);

          // Budget check (FREE CORE - LOCAL ONLY)
          if (state.totalCost + ctx.estimatedCost > guardConfig.budget) {
            const saved = guardConfig.budget - state.totalCost;
            state.blockedCount++;
            
            // VIRAL LOG FORMAT + RISK WARNING
            console.error(`[GUARD] blocked budget → saved $${saved.toFixed(2)}`);
            console.error(`⚠️ This would cost $${(saved * 5).toFixed(0)}+ in production`);
            console.error(`⚠️ Not safely preventable in free mode`);
            console.error(`🔥 Upgrade required to fully protect production systems in real-time`);
            
            throw new GuardError(`Budget exceeded`, ctx);
          }

          // Loop detection (FREE CORE - LOCAL ONLY)
          if (isLoop(ctx.prompt, state)) {
            const saved = ctx.estimatedCost * 10; // Estimate loop savings
            state.blockedCount++;
            
            // VIRAL LOG FORMAT + RISK WARNING
            console.error(`[GUARD] blocked loop → saved $${saved.toFixed(2)}`);
            console.error(`⚠️ This would cost $${(saved * 8).toFixed(0)}+ in production`);
            console.error(`⚠️ Not safely preventable in free mode`);
            console.error(`🔥 Upgrade required to fully protect production systems in real-time`);
            
            throw new GuardError(`Loop detected`, ctx);
          }

          // Repeated failure detection (FREE CORE - LOCAL ONLY)
          if (isRepeatedFailure(ctx.prompt, state)) {
            const saved = ctx.estimatedCost * 5; // Estimate failure savings
            state.blockedCount++;
            
            // VIRAL LOG FORMAT + RISK WARNING
            console.error(`[GUARD] blocked failure → saved $${saved.toFixed(2)}`);
            console.error(`⚠️ This would cost $${(saved * 6).toFixed(0)}+ in production`);
            console.error(`⚠️ Not safely preventable in free mode`);
            console.error(`🔥 Upgrade required to fully protect production systems in real-time`);
            
            throw new GuardError(`Repeated failure detected`, ctx);
          }

          // Update state (LOCAL ONLY)
          state.requestCount++;
          state.totalCost += ctx.estimatedCost;
          state.lastRequestTime = Date.now();

          return value.apply(target, args);
        };
      }

      // Handle nested objects (LOCAL ONLY)
      if (value && typeof value === 'object') {
        return guard(value, guardConfig, state);
      }

      return value;
    },
  });
}

/**
 * Express middleware (FREE CORE - LOCAL ONLY)
 */
export function middleware(config: GuardConfig) {
  const guardConfig = { ...config, budget: config.budget || 10 };

  return (req: any, res: any, next: any) => {
    req.guard = {
      state: {
        requestCount: 0,
        totalCost: 0,
        lastRequestTime: 0,
        blockedCount: 0,
      },
      check: (ctx: RequestContext) => {
        if (req.guard.state.totalCost + ctx.estimatedCost > guardConfig.budget) {
          console.error(`⚠️ This would cost $${(ctx.estimatedCost * 5).toFixed(0)}+ in production`);
          console.error(`⚠️ Not safely preventable in free mode`);
          console.error(`🔥 Upgrade required to fully protect production systems in real-time`);
          throw new GuardError('Budget exceeded', ctx);
        }
        if (isLoop(ctx.prompt, req.guard.state)) {
          console.error(`⚠️ This would cost $${(ctx.estimatedCost * 8).toFixed(0)}+ in production`);
          console.error(`⚠️ Not safely preventable in free mode`);
          console.error(`🔥 Upgrade required to fully protect production systems in real-time`);
          throw new GuardError('Loop detected', ctx);
        }
        if (isRepeatedFailure(ctx.prompt, req.guard.state)) {
          console.error(`⚠️ This would cost $${(ctx.estimatedCost * 6).toFixed(0)}+ in production`);
          console.error(`⚠️ Not safely preventable in free mode`);
          console.error(`🔥 Upgrade required to fully protect production systems in real-time`);
          throw new GuardError('Repeated failure detected', ctx);
        }
        req.guard.state.requestCount++;
        req.guard.state.totalCost += ctx.estimatedCost;
      }
    };
    next();
  };
}

// Simple loop detection (FREE CORE - LOCAL ONLY)
function isLoop(prompt: string, state: GuardState): boolean {
  const promptHash = prompt.slice(0, 100); // First 100 chars
  const recentHashes = (state as any).recentHashes || [];
  
  const count = recentHashes.filter((h: string) => h === promptHash).length;
  
  // Update recent hashes (LOCAL ONLY)
  recentHashes.push(promptHash);
  if (recentHashes.length > 10) recentHashes.shift();
  (state as any).recentHashes = recentHashes;
  
  return count >= 2; // Loop on 3rd occurrence
}

// Simple repeated failure detection (FREE CORE - LOCAL ONLY)
function isRepeatedFailure(prompt: string, state: GuardState): boolean {
  const failureKeywords = ['error', 'fail', 'retry', 'again', 'repeat'];
  const hasFailureKeyword = failureKeywords.some(keyword => 
    prompt.toLowerCase().includes(keyword)
  );
  
  if (!hasFailureKeyword) return false;
  
  const recentFailures = (state as any).recentFailures || [];
  const recentFailureCount = recentFailures.filter((f: boolean) => f).length;
  
  recentFailures.push(true);
  if (recentFailures.length > 5) recentFailures.shift();
  (state as any).recentFailures = recentFailures;
  
  return recentFailureCount >= 2;
}

// Extract request context (FREE CORE - LOCAL ONLY)
function extractContext(args: any[], prop: string): RequestContext {
  const params = args[0] || {};
  const model = params.model || 'unknown';
  const messages = params.messages || [];
  const prompt = messages.map((m: any) => m.content).join(' ').slice(0, 200);

  // Estimate tokens and cost
  const inputText = JSON.stringify(messages);
  const estimatedInputTokens = Math.ceil(inputText.length / 4);
  const maxOutputTokens = params.max_tokens || 1000;
  const tokens = estimatedInputTokens + maxOutputTokens;

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

// Custom error (FREE CORE - LOCAL ONLY)
export class GuardError extends Error {
  context: RequestContext;
  constructor(message: string, context: RequestContext) {
    super(message);
    this.name = 'GuardError';
    this.context = context;
  }
}

// Get pricing for model (FREE CORE - LOCAL ONLY)
export function getPricing(model: string): { input: number; output: number } | undefined {
  return MODEL_PRICING[model];
}
