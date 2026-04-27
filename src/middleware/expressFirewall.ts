/**
 * AI Execution Firewall - Express Middleware
 *
 * Provides automatic request interception for Express applications.
 * Inspects incoming AI-related requests and applies firewall protection.
 *
 * Usage:
 *   import { expressFirewall } from 'ai-execution-firewall';
 *
 *   const app = express();
 *   app.use(expressFirewall());
 *
 *   // Or with options:
 *   app.use(expressFirewall({
 *     trustMode: 'block',
 *     onBlock: (req, res, reason) => {
 *       res.status(403).json({ error: 'Blocked', reason });
 *     }
 *   }));
 */

import { Request, Response, NextFunction } from 'express';
import { detectionEngine } from '../core/DetectionEngine';
import { estimateMessagesTokens } from '../token-counter';
import { estimateCost } from '../config';
import { ConfigManager } from '../config';
import { logger } from '../logger';

interface FirewallMiddlewareOptions {
  trustMode?: 'monitor' | 'warn' | 'block';
  paths?: string[]; // Paths to protect (default: ['/v1/chat/completions', '/v1/messages'])
  onBlock?: (req: Request, res: Response, reason: string, dangerScore: number) => void;
  onWarn?: (req: Request, reason: string, dangerScore: number) => void;
  onAllow?: (req: Request) => void;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AIRequestBody {
  model?: string;
  messages?: ChatMessage[];
  prompt?: string;
  max_tokens?: number;
  temperature?: number;
  [key: string]: any;
}

/**
 * Default paths that should be protected by the firewall
 */
const DEFAULT_PROTECTED_PATHS = [
  '/v1/chat/completions',
  '/v1/messages',
  '/v1/completions',
  '/api/openai',
  '/api/anthropic',
];

/**
 * Check if a request path should be protected
 */
function shouldProtectPath(path: string, protectedPaths: string[]): boolean {
  return protectedPaths.some(protectedPath =>
    path === protectedPath || path.startsWith(protectedPath + '/')
  );
}

/**
 * Extract prompt text from request body
 */
function extractPrompt(body: AIRequestBody): string {
  if (body.prompt) {
    return body.prompt;
  }

  if (body.messages && Array.isArray(body.messages)) {
    return JSON.stringify(body.messages);
  }

  return JSON.stringify(body);
}

/**
 * Create Express middleware for AI Execution Firewall
 */
export function expressFirewall(
  options: FirewallMiddlewareOptions = {}
): (req: Request, res: Response, next: NextFunction) => void {
  const config = new ConfigManager();
  const trustMode = options.trustMode || config.trustMode;
  const protectedPaths = options.paths || DEFAULT_PROTECTED_PATHS;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Only process POST requests to protected paths
    if (req.method !== 'POST' || !shouldProtectPath(req.path, protectedPaths)) {
      return next();
    }

    const body = req.body as AIRequestBody;

    // Skip if no body or no AI-related fields
    if (!body || (!body.messages && !body.prompt)) {
      return next();
    }

    const model = body.model || 'gpt-4';
    const prompt = extractPrompt(body);

    // Estimate tokens and cost
    const inputTokens = body.messages
      ? estimateMessagesTokens(body.messages, model)
      : 0;
    const estimatedOutputTokens = body.max_tokens || 1000;
    const estimatedCost = estimateCost(model, inputTokens, estimatedOutputTokens);

    // Analyze with DetectionEngine (single source of truth)
    const result = detectionEngine.analyze({
      model,
      prompt,
      estimatedCost,
      trustMode,
      override: false,
    });

    // Handle blocked request
    if (result.decision === 'block') {
      logger.warn(`🔴 Express BLOCKED: ${result.reason} (score: ${result.dangerScore})`);

      if (options.onBlock) {
        options.onBlock(req, res, result.reason, result.dangerScore);
        return;
      }

      // Default block response
      res.status(403).json({
        error: 'Request blocked by AI Execution Firewall',
        reason: result.reason,
        dangerScore: result.dangerScore,
        category: result.category,
        estimatedCost,
        savedAmount: estimatedCost,
      });
      return;
    }

    // Handle warning
    if (result.decision === 'warn') {
      logger.warn(`⚠️  Express Warning: ${result.reason} (score: ${result.dangerScore})`);

      if (options.onWarn) {
        options.onWarn(req, result.reason, result.dangerScore);
      }
    }

    // Call onAllow callback if provided
    if (options.onAllow) {
      options.onAllow(req);
    }

    // Allow request to proceed
    next();
  };
}

/**
 * Create a firewall-aware request handler
 * Combines firewall check with your existing route handler
 */
export function withFirewallHandler(
  handler: (req: Request, res: Response, next: NextFunction) => void | Promise<void>,
  options: FirewallMiddlewareOptions = {}
): (req: Request, res: Response, next: NextFunction) => void {
  const firewall = expressFirewall(options);

  return (req: Request, res: Response, next: NextFunction): void => {
    firewall(req, res, (err?: any) => {
      if (err) {
        return next(err);
      }

      // If firewall passed, call the handler
      handler(req, res, next);
    });
  };
}

export { FirewallMiddlewareOptions, AIRequestBody, ChatMessage };
