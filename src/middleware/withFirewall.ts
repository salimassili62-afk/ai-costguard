/**
 * AI Execution Firewall - SDK and fetch middleware.
 */

import { detectionEngine } from '../core/DetectionEngine';
import { estimateMessagesTokens } from '../token-counter';
import { estimateCost } from '../config';
import { ConfigManager } from '../config';
import { logger } from '../logger';
import { costLedger } from '../core/CostLedger';
import { FirewallMetadata, TokenBreakdown } from '../core/types';

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
  metadata?: FirewallMetadata;
}

interface FirewallOptions {
  trustMode?: 'monitor' | 'warn' | 'block';
  overrideBlock?: boolean;
  metadata?: FirewallMetadata | ((request: OpenAIRequest) => FirewallMetadata);
  onBlock?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onWarn?: (reason: string, dangerScore: number, estimatedCost: number) => void;
  onSpike?: (requests: number, timeWindow: number) => void;
  debug?: boolean;
}

function extractPrompt(args: any[]): {
  model: string;
  prompt: string;
  maxTokens: number;
  request?: OpenAIRequest;
} {
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

  return { model, prompt, maxTokens, request };
}

function isAICall(path: string[]): boolean {
  const pathStr = path.join('.');
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
    'models.generateContent',
    'generateContent',
  ];
  return aiPatterns.some((pattern) => pathStr.includes(pattern));
}

function resolveMetadata(request: OpenAIRequest | undefined, options: FirewallOptions): FirewallMetadata | undefined {
  const optionMetadata =
    typeof options.metadata === 'function' ? options.metadata(request || { model: 'unknown' }) : options.metadata;

  return {
    ...(optionMetadata || {}),
    ...(request?.metadata || {}),
  };
}

function toTokenBreakdown(inputTokens: number, outputTokens: number): TokenBreakdown {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function wrap<T extends object>(target: T, path: string[] = [], options: FirewallOptions): T {
  const config = new ConfigManager();
  const trustMode = options.trustMode || config.trustMode;

  return new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop as keyof typeof obj];
      const newPath = [...path, String(prop)];

      if (typeof value === 'function') {
        return async function (this: any, ...args: any[]) {
          if (options.debug) {
            console.log('INTERCEPTED CALL:', newPath.join('.'));
          }

          if (isAICall(newPath)) {
            const { model, prompt, maxTokens, request } = extractPrompt(args);
            const messages = args[0]?.messages;
            const inputTokens = messages ? estimateMessagesTokens(messages, model) : 0;
            const estimatedCost = estimateCost(model, inputTokens, maxTokens);
            const tokens = toTokenBreakdown(inputTokens, maxTokens);

            const result = detectionEngine.analyze({
              model,
              prompt,
              estimatedCost,
              trustMode,
              override: options.overrideBlock || false,
              metadata: resolveMetadata(request, options),
              tokens,
              onBlock: options.onBlock,
              onWarn: options.onWarn,
              onSpike: options.onSpike,
            });

            const ledgerId = costLedger.recordEstimate({
              prompt,
              model,
              estimatedCost,
              estimatedTokens: inputTokens + maxTokens,
              inputTokens,
              outputTokens: maxTokens,
              saved: result.saved,
              wouldHaveLost: result.wouldHaveLost,
            });

            if (result.decision === 'block' && !options.overrideBlock) {
              logger.warn(`BLOCKED by Firewall: ${result.reason} (score: ${result.dangerScore})`);
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

            if (result.decision === 'warn') {
              logger.warn(`Warning: ${result.reason} (score: ${result.dangerScore})`);
            }

            const response = await value.apply(obj, args);
            costLedger.recordActualFromResponse(ledgerId, response, model);
            return response;
          }

          return value.apply(obj, args);
        };
      }

      if (typeof value === 'object' && value !== null) {
        return wrap(value, newPath, options);
      }

      return value;
    },
  });
}

export function withFirewall<T extends object>(client: T, options: FirewallOptions = {}): T {
  return wrap(client, [], options);
}

export function wrapFunction<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  requestExtractor: (...args: Parameters<T>) => {
    model: string;
    prompt: string;
    estimatedCost?: number;
    metadata?: FirewallMetadata;
  },
  options: FirewallOptions = {}
): T {
  const config = new ConfigManager();
  const trustMode = options.trustMode || config.trustMode;

  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const requestData = requestExtractor(...args);
    const estimatedCost = requestData.estimatedCost || 0;

    const result = detectionEngine.analyze({
      model: requestData.model,
      prompt: requestData.prompt,
      estimatedCost,
      trustMode,
      override: options.overrideBlock || false,
      metadata: {
        ...(typeof options.metadata === 'function'
          ? options.metadata({ model: requestData.model, prompt: requestData.prompt })
          : options.metadata || {}),
        ...(requestData.metadata || {}),
      },
      onBlock: options.onBlock,
      onWarn: options.onWarn,
      onSpike: options.onSpike,
    });

    if (result.decision === 'block' && !options.overrideBlock) {
      logger.warn(`BLOCKED: ${result.reason} (score: ${result.dangerScore})`);
      throw new Error(`Request blocked by AI Execution Firewall: ${result.reason}`);
    }

    if (result.decision === 'warn') {
      logger.warn(`Warning: ${result.reason} (score: ${result.dangerScore})`);
    }

    return fn(...args);
  }) as T;
}

export type FetchLike = (input: any, init?: any) => Promise<any>;

export function withFetchFirewall(fetchImpl: FetchLike, options: FirewallOptions = {}): FetchLike {
  const config = new ConfigManager();
  const trustMode = options.trustMode || config.trustMode;

  return async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const body = typeof init?.body === 'string' ? safeJsonParse(init.body) : init?.body;
    const pathLooksAi = [
      '/v1/chat/completions',
      '/v1/responses',
      '/v1/messages',
      '/generateContent',
      '/chat/completions',
    ].some((pattern) => url.includes(pattern));

    if (!pathLooksAi || !body) {
      return fetchImpl(input, init);
    }

    const request = body as OpenAIRequest;
    const model = request.model || 'unknown';
    const prompt = request.messages ? JSON.stringify(request.messages) : request.prompt || JSON.stringify(request);
    const inputTokens = request.messages ? estimateMessagesTokens(request.messages, model) : 0;
    const outputTokens = request.max_tokens || 1000;
    const estimatedCost = estimateCost(model, inputTokens, outputTokens);
    const result = detectionEngine.analyze({
      model,
      prompt,
      estimatedCost,
      trustMode,
      override: options.overrideBlock || false,
      metadata: resolveMetadata(request, options),
      tokens: toTokenBreakdown(inputTokens, outputTokens),
      onBlock: options.onBlock,
      onWarn: options.onWarn,
      onSpike: options.onSpike,
    });

    if (result.decision === 'block' && !options.overrideBlock) {
      throw new Error(`Request blocked by AI Execution Firewall: ${result.reason}`);
    }

    return fetchImpl(input, init);
  };
}

function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export { FirewallOptions, OpenAIRequest, ChatMessage };
