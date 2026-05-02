/**
 * AI Execution Firewall - Middleware Layer
 *
 * Provides automatic request interception for OpenAI, fetch, and axios.
 * Uses DEEP RECURSIVE PROXY to intercept ALL nested SDK calls.
 *
 * Usage:
 *   const openai = withFirewall(new OpenAI({ apiKey: '...' }));
 *   const response = await openai.chat.completions.create({...});
 *   const response = await openai.responses.create({...});  // Also intercepted!
 *
 *   // Or wrap fetch:
 *   const safeFetch = withFirewall(fetch);
 *
 *   // Or wrap axios:
 *   const safeAxios = withFirewall(axios);
 */

import { detectionEngine } from '../core/DetectionEngine';
import { estimateMessagesTokens } from '../token-counter';
import { estimateCost } from '../config';
import { ConfigManager } from '../config';
import { logger } from '../logger';

// Types for OpenAI-compatible clients
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages?: ChatMessage[];
  prompt?: string;
  max_tokens?: number;
  temperature?: number;
  input?: string | ChatMessage[];
}

interface FirewallOptions {
  trustMode?: 'monitor' | 'warn' | 'block';
  overrideBlock?: boolean;
  onBlock?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onWarn?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onSpike?: (requests: number, timeWindow: number) => void;
  debug?: boolean;
}

/**
 * Extract prompt text from request arguments
 */
function extractPrompt(args: any[]): { model: string; prompt: string; maxTokens: number } {
  const request = args[0] as OpenAIRequest | undefined;

  if (!request) {
    return { model: 'unknown', prompt: '', maxTokens: 1000 };
  }

  const model = request.model || 'gpt-4';
  const maxTokens = request.max_tokens || 1000;

  let prompt = '';
  if (request.prompt) {
    prompt = request.prompt;
  } else if (request.messages && Array.isArray(request.messages)) {
    prompt = JSON.stringify(request.messages);
  } else if (request.input) {
    prompt = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
  } else {
    prompt = JSON.stringify(request);
  }

  return { model, prompt, maxTokens };
}

/**
 * Check if this is an AI API call that should be analyzed
 */
function isAICall(path: string[]): boolean {
  const pathStr = path.join('.');
  // Intercept common OpenAI SDK methods
  const aiPatterns = [
    'chat.completions.create',
    'completions.create',
    'responses.create',
    'embeddings.create',
    'images.generate',
    'audio.transcriptions.create',
    'audio.translations.create',
    'moderations.create',
    'beta.chat.completions.create',
    'beta.assistants.create',
    'beta.threads.messages.create',
  ];
  return aiPatterns.some(pattern => pathStr.includes(pattern));
}

/**
 * Deep recursive proxy that wraps all nested objects and intercepts method calls
 */
function wrap<T extends object>(
  target: T,
  path: string[] = [],
  options: FirewallOptions
): T {
  const config = new ConfigManager();
  const trustMode = options.trustMode || config.trustMode;

  return new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop as keyof typeof obj];
      const newPath = [...path, String(prop)];

      // If it's a function, wrap it to intercept calls
      if (typeof value === 'function') {
        return async function (this: any, ...args: any[]) {
          // Debug log
          if (options.debug) {
            console.log('INTERCEPTED CALL:', newPath.join('.'));
          }

          // Check if this is an AI API call
          if (isAICall(newPath)) {
            const { model, prompt, maxTokens } = extractPrompt(args);

            // Estimate tokens and cost
            const messages = args[0]?.messages;
            const inputTokens = messages
              ? estimateMessagesTokens(messages, model)
              : 0;
            const estimatedCost = estimateCost(model, inputTokens, maxTokens);

            // Analyze with DetectionEngine (single source of truth)
            // Pass alert hooks for real-time notifications
            const result = detectionEngine.analyze({
              model,
              prompt,
              estimatedCost,
              trustMode,
              override: options.overrideBlock || false,
              onBlock: options.onBlock,
              onWarn: options.onWarn,
              onSpike: options.onSpike,
            });

            // Handle blocked request
            if (result.decision === 'block' && !options.overrideBlock) {
              logger.warn(`🔴 BLOCKED by Firewall: ${result.reason} (score: ${result.dangerScore})`);

              if (options.onBlock) {
                options.onBlock(result.reason, result.dangerScore, estimatedCost);
              }

              // Return a rejected promise that mimics OpenAI error format
              return Promise.reject({
                error: {
                  message: `Request blocked by AI Execution Firewall: ${result.reason}`,
                  type: 'firewall_blocked',
                  dangerScore: result.dangerScore,
                  category: result.category,
                },
                blocked: true,
              });
            }

            // Handle warning
            if (result.decision === 'warn') {
              logger.warn(`⚠️  Warning: ${result.reason} (score: ${result.dangerScore})`);

              if (options.onWarn) {
                options.onWarn(result.reason, result.dangerScore, estimatedCost);
              }
            }
          }

          // Call the original function
          return value.apply(obj, args);
        };
      }

      // If it's an object (and not null), recursively wrap it
      if (typeof value === 'object' && value !== null) {
        return wrap(value, newPath, options);
      }

      // Return primitive values as-is
      return value;
    },
  });
}

/**
 * Wrap an OpenAI SDK client with firewall protection using deep recursive proxy
 */
export function withFirewall<T extends object>(
  client: T,
  options: FirewallOptions = {}
): T {
  return wrap(client, [], options);
}

/**
 * Wrap a generic async function with firewall protection
 */
export function wrapFunction<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  requestExtractor: (...args: Parameters<T>) => {
    model: string;
    prompt: string;
    estimatedCost?: number;
  },
  options: FirewallOptions = {}
): T {
  const config = new ConfigManager();
  const trustMode = options.trustMode || config.trustMode;

  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    // Extract request data
    const requestData = requestExtractor(...args);

    // Analyze with DetectionEngine
    const result = detectionEngine.analyze({
      model: requestData.model,
      prompt: requestData.prompt,
      estimatedCost: requestData.estimatedCost || 0,
      trustMode,
      override: options.overrideBlock || false,
    });

    // Handle blocked request
    if (result.decision === 'block' && !options.overrideBlock) {
      logger.warn(`🔴 BLOCKED: ${result.reason} (score: ${result.dangerScore})`);

      if (options.onBlock) {
        options.onBlock(result.reason, result.dangerScore, requestData.estimatedCost || 0);
      }

      throw new Error(`Request blocked by AI Execution Firewall: ${result.reason}`);
    }

    // Handle warning
    if (result.decision === 'warn') {
      logger.warn(`⚠️  Warning: ${result.reason} (score: ${result.dangerScore})`);

      if (options.onWarn) {
        options.onWarn(result.reason, result.dangerScore, requestData.estimatedCost || 0);
      }
    }

    // Execute original function
    return fn(...args);
  }) as T;
}

export { FirewallOptions, OpenAIRequest, ChatMessage };
