/**
 * GuardFree.ts - LOCAL ILLUSION OF SAFETY (FREE VERSION)
 * 
 * Each process thinks it is safe.
 * Single-process protection only.
 * 
 * INSTALL: const ai = guard(openai)
 */

import { getPricing as lookupPricing } from '../pricing/index.js';
import { GuardConfig, RequestContext, GuardState } from './types.js';

/**
 * Local Safety Illusion - FREE VERSION
 * 
 * Each process thinks it is safe.
 * Single-process protection only.
 * 
 * WARNING: Process-local only. Not production safe.
 */
export function guard(client: any, config: GuardConfig, sharedState?: GuardState) {
  const defaults: GuardConfig = {
    budget: 10
  };

  const guardConfig = { ...defaults, ...config };
  
  // Process-local state only - each process thinks it's safe
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

          // Local budget check - each process thinks it's safe
          if (state.totalCost + ctx.estimatedCost > guardConfig.budget) {
            const saved = guardConfig.budget - state.totalCost;
            state.blockedCount++;
            
            console.error(`🚨 LOCAL SAFETY: Budget exceeded → saved $${saved.toFixed(2)}`);
            throw new GuardError(`Budget exceeded`, ctx);
          }

          // Local loop detection - basic hash only
          if (detectLocalLoop(ctx.prompt, state)) {
            const saved = ctx.estimatedCost * 20;
            state.blockedCount++;
            
            console.error(`🚨 LOCAL SAFETY: Loop detected → saved $${saved.toFixed(2)}`);
            throw new GuardError(`Loop detected`, ctx);
          }

          // Local retry detection - basic keyword only
          if (detectLocalRetry(ctx.prompt, state)) {
            const saved = ctx.estimatedCost * 10;
            state.blockedCount++;
            
            console.error(`🚨 LOCAL SAFETY: Retry detected → saved $${saved.toFixed(2)}`);
            throw new GuardError(`Retry detected`, ctx);
          }

          // Update local state only
          state.requestCount++;
          state.totalCost += ctx.estimatedCost;
          state.lastRequestTime = Date.now();

          return value.apply(target, args);
        };
      }

      // Handle nested objects (local only)
      if (value && typeof value === 'object') {
        return guard(value, guardConfig, state);
      }

      return value;
    },
  });
}

/**
 * Express middleware - Local safety for web apps
 */
export function middleware(config: GuardConfig) {
  const guardConfig = { ...config, budget: config.budget || 10 };

  return (req: any, res: any, next: any) => {
    req.localSafety = {
      state: {
        requestCount: 0,
        totalCost: 0,
        lastRequestTime: 0,
        blockedCount: 0,
      },
      check: (ctx: RequestContext) => {
        if (req.localSafety.state.totalCost + ctx.estimatedCost > guardConfig.budget) {
          throw new GuardError('Budget exceeded', ctx);
        }
        if (detectLocalLoop(ctx.prompt, req.localSafety.state)) {
          throw new GuardError('Loop detected', ctx);
        }
        if (detectLocalRetry(ctx.prompt, req.localSafety.state)) {
          throw new GuardError('Retry detected', ctx);
        }
        req.localSafety.state.requestCount++;
        req.localSafety.state.totalCost += ctx.estimatedCost;
      }
    };
    next();
  };
}

// Local loop detection - basic hash only (each process thinks it's safe)
function detectLocalLoop(prompt: string, state: GuardState): boolean {
  const promptHash = prompt.slice(0, 100);
  const recentHashes = (state as any).recentHashes || [];
  
  const count = recentHashes.filter((h: string) => h === promptHash).length;
  
  recentHashes.push(promptHash);
  if (recentHashes.length > 5) recentHashes.shift(); // Very limited memory
  (state as any).recentHashes = recentHashes;
  
  return count >= 3; // Basic detection only
}

// Local retry detection - basic keyword only (each process thinks it's safe)
function detectLocalRetry(prompt: string, state: GuardState): boolean {
  const retryKeywords = ['retry', 'again', 'repeat', 'error', 'fail', 'timeout'];
  const hasRetryKeyword = retryKeywords.some(keyword => 
    prompt.toLowerCase().includes(keyword)
  );
  
  if (!hasRetryKeyword) return false;
  
  const recentRetries = (state as any).recentRetries || [];
  const recentRetryCount = recentRetries.filter((r: boolean) => r).length;
  
  recentRetries.push(true);
  if (recentRetries.length > 3) recentRetries.shift(); // Very limited memory
  (state as any).recentRetries = recentRetries;
  
  return recentRetryCount >= 2; // Basic detection only
}

// Extract request context (local only)
function extractContext(args: any[], prop: string): RequestContext {
  const params = args[0] || {};
  const model = params.model || 'unknown';
  const messages = params.messages || [];
  const prompt = messages.map((m: any) => m.content).join(' ').slice(0, 200);

  const inputText = JSON.stringify(messages);
  const estimatedInputTokens = Math.ceil(inputText.length / 4);
  const maxOutputTokens = params.max_tokens || 1000;
  const tokens = estimatedInputTokens + maxOutputTokens;

  const pricing = lookupPricing(model);
  const inputPer1kTokens = pricing?.inputPer1kTokens ?? 0.01;
  const outputPer1kTokens = pricing?.outputPer1kTokens ?? 0.03;
  const estimatedCost = (estimatedInputTokens / 1000) * inputPer1kTokens +
                        (maxOutputTokens / 1000) * outputPer1kTokens;

  return {
    model,
    tokens,
    estimatedCost,
    timestamp: Date.now(),
    prompt,
  };
}

// Custom error (local only)
export class GuardError extends Error {
  context: RequestContext;
  constructor(message: string, context?: RequestContext) {
    super(message);
    this.name = 'GuardError';
    this.context = context!;
  }
}
