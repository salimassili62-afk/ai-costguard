/**
 * AI Execution Firewall - Middleware Layer
 *
 * This is not a framework.
 * It is a pre-execution cost + safety enforcement layer for AI systems.
 * Provides automatic request interception for OpenAI-compatible SDK calls.
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

import { ExecutionGuard } from '../firewall/executionGuard';
import { GuardPolicy } from '../firewall/types';

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
  policy?: Partial<GuardPolicy>;
  onBlock?: (reason: string, estimatedCost: number) => void;
  onThrottle?: (reason: string, estimatedCost: number, waitMs: number) => void;
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
  const maxTokens = request.max_tokens || 512;

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
function wrap<T extends object>(target: T, path: string[] = [], options: FirewallOptions): T {
  const guard = new ExecutionGuard(options.policy);

  return new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop as keyof typeof obj];
      const newPath = [...path, String(prop)];

      // If it's a function, wrap it to intercept calls
      if (typeof value === 'function') {
        return async function (this: any, ...args: any[]) {
          if (isAICall(newPath)) {
            const { model, prompt, maxTokens } = extractPrompt(args);
            const result = guard.evaluate({
              model,
              prompt,
              maxOutputTokens: maxTokens,
            });

            if (result.decision === 'block') {
              if (options.onBlock) {
                options.onBlock(result.reason, result.estimatedCostUsd);
              }

              return Promise.reject({
                error: {
                  message: `Request blocked by AI waste firewall: ${result.reason}`,
                  type: 'firewall_blocked',
                  estimatedCostUsd: result.estimatedCostUsd,
                },
                blocked: true,
              });
            }

            if (result.decision === 'throttle' && result.throttleMs) {
              if (options.onThrottle) {
                options.onThrottle(result.reason, result.estimatedCostUsd, result.throttleMs);
              }
              await new Promise(resolve => setTimeout(resolve, result.throttleMs));
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
    maxOutputTokens?: number;
  },
  options: FirewallOptions = {}
): T {
  const guard = new ExecutionGuard(options.policy);

  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const requestData = requestExtractor(...args);
    const result = guard.evaluate({
      model: requestData.model,
      prompt: requestData.prompt,
      maxOutputTokens: requestData.maxOutputTokens,
    });

    if (result.decision === 'block') {
      if (options.onBlock) {
        options.onBlock(result.reason, result.estimatedCostUsd);
      }
      throw new Error(`Request blocked by AI waste firewall: ${result.reason}`);
    }

    if (result.decision === 'throttle' && result.throttleMs) {
      if (options.onThrottle) {
        options.onThrottle(result.reason, result.estimatedCostUsd, result.throttleMs);
      }
      await new Promise(resolve => setTimeout(resolve, result.throttleMs));
    }

    return fn(...args);
  }) as T;
}

export { FirewallOptions, OpenAIRequest, ChatMessage };
