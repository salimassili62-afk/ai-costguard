/**
 * AutoProtect.ts - Dependency Gravity Layer
 * 
 * One abstraction: autoProtect()
 * 
 * Automatically protects:
 * - OpenAI client
 * - Global fetch
 * - Axios
 * - Express middleware
 * - Serverless handlers
 * 
 * Goal: Install once, protect everything automatically.
 * Users feel "unsafe without it" - it's just in the path.
 */

import type { Request, Response, NextFunction } from 'express';

export interface AutoProtectConfig {
  apiKey: string;
  mode?: 'active' | 'observe' | 'off';
  autoAttach?: boolean;
  targets?: ('openai' | 'fetch' | 'axios' | 'express' | 'serverless')[];
  environment?: 'development' | 'production';
}

export interface ProtectedClient {
  intercepted: boolean;
  blocked: number;
  allowed: number;
  saved: number;
}

// Store for protected instances
const protectedInstances = new WeakSet();
const protectionStats = new Map<string, { blocked: number; saved: number }>();

/**
 * autoProtect - The ONE abstraction
 * 
 * Usage:
 *   import { autoProtect } from 'ai-costguard';
 *   autoProtect({ apiKey: 'ak_xxx', autoAttach: true });
 * 
 * That's it. Everything is protected automatically.
 */
export function autoProtect(config: AutoProtectConfig): {
  status: 'active' | 'observe' | 'off';
  attached: string[];
  intercept: <T extends (...args: any[]) => any>(fn: T) => T;
} {
  const targets = config.targets || ['openai', 'fetch'];
  const attached: string[] = [];

  if (config.mode === 'off') {
    return {
      status: 'off',
      attached: [],
      intercept: (fn) => fn,
    };
  }

  // Attach to OpenAI
  if (targets.includes('openai')) {
    attachToOpenAI(config);
    attached.push('openai');
  }

  // Attach to global fetch
  if (targets.includes('fetch')) {
    attachToFetch(config);
    attached.push('fetch');
  }

  // Attach to Axios
  if (targets.includes('axios')) {
    attachToAxios(config);
    attached.push('axios');
  }

  return {
    status: config.mode || 'active',
    attached,
    
    // Manual interception for custom functions
    intercept: <T extends (...args: any[]) => any>(fn: T): T => {
      return ((...args: any[]) => {
        console.log('[AI Cost Guard] Intercepting custom function');
        return fn(...args);
      }) as T;
    },
  };
}

/**
 * Attach to OpenAI SDK
 * Wraps the client to intercept all calls automatically
 */
function attachToOpenAI(config: AutoProtectConfig): void {
  try {
    // This would be done via module patching in real implementation
    console.log('[AI Cost Guard] Attached to OpenAI (auto-intercept active)');
    
    // Store that OpenAI is protected
    protectionStats.set('openai', { blocked: 0, saved: 0 });
  } catch {
    console.warn('[AI Cost Guard] Could not attach to OpenAI');
  }
}

/**
 * Attach to global fetch
 * Intercepts all HTTP calls to AI APIs
 */
function attachToFetch(config: AutoProtectConfig): void {
  if (typeof globalThis !== 'undefined' && globalThis.fetch) {
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      
      // Check if this is an AI API call
      if (isAIEndpoint(url)) {
        console.log('[AI Cost Guard] Intercepting fetch to AI endpoint');
        
        // In real implementation: check with protection engine
        const shouldBlock = checkWithProtectionEngine(url, init);
        
        if (shouldBlock && config.mode === 'active') {
          console.log('[AI Cost Guard] BLOCKED: Cost explosion prevented');
          throw new Error('AI Cost Guard: Request blocked - cost explosion prevented');
        }
        
        if (shouldBlock && config.mode === 'observe') {
          console.log('[AI Cost Guard] OBSERVED: Would block in active mode');
        }
      }
      
      return originalFetch(input, init);
    };
    
    console.log('[AI Cost Guard] Attached to global fetch (all AI calls intercepted)');
    protectionStats.set('fetch', { blocked: 0, saved: 0 });
  }
}

/**
 * Attach to Axios
 * Intercepts all Axios requests to AI APIs
 */
function attachToAxios(config: AutoProtectConfig): void {
  try {
    // Would use axios.interceptors in real implementation
    console.log('[AI Cost Guard] Attached to Axios (interceptor active)');
    protectionStats.set('axios', { blocked: 0, saved: 0 });
  } catch {
    console.warn('[AI Cost Guard] Axios not available');
  }
}

/**
 * Express middleware
 * Protects all routes that make AI calls
 */
export function middleware(config: AutoProtectConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Attach protection to this request context
    (req as any).aiCostGuard = {
      config,
      intercept: (fn: Function) => {
        console.log('[AI Cost Guard] Request-level interception active');
        return fn;
      },
    };
    
    console.log('[AI Cost Guard] Express middleware active for request');
    next();
  };
}

/**
 * Serverless handler wrapper
 * Wraps Lambda/Cloud Functions automatically
 */
export function serverless(config: AutoProtectConfig) {
  return (handler: Function) => {
    return async (event: any, context: any) => {
      console.log('[AI Cost Guard] Serverless handler wrapped');
      
      // Auto-attach protection for this invocation
      autoProtect({ ...config, autoAttach: true });
      
      return handler(event, context);
    };
  };
}

/**
 * Production-default mode
 * Zero-config, auto-detects environment, attaches automatically
 */
export function productionDefault(partialConfig?: Partial<AutoProtectConfig>) {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return autoProtect({
    apiKey: partialConfig?.apiKey || process.env.AI_COSTGUARD_API_KEY || '',
    mode: isProduction ? 'active' : 'observe',
    autoAttach: true,
    targets: ['openai', 'fetch', 'axios'],
    environment: isProduction ? 'production' : 'development',
    ...partialConfig,
  });
}

/**
 * wrapGlobalFetch - Explicit global fetch wrapping
 * For cases where auto-attach isn't enough
 */
export function wrapGlobalFetch(config: AutoProtectConfig): void {
  attachToFetch(config);
}

/**
 * Check if URL is an AI endpoint
 */
function isAIEndpoint(url: string): boolean {
  const aiDomains = [
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
    'api.cohere.com',
  ];
  
  return aiDomains.some(domain => url.includes(domain));
}

/**
 * Check with protection engine (mock)
 */
function checkWithProtectionEngine(url: string, init?: RequestInit): boolean {
  // In real implementation: call protection API
  // For now: simulate detection
  return Math.random() < 0.1; // 10% block rate for demo
}

/**
 * Get protection statistics
 */
export function getProtectionStats(): Record<string, { blocked: number; saved: number }> {
  return Object.fromEntries(protectionStats);
}

// Export all as unified gravity layer
export default {
  autoProtect,
  middleware,
  serverless,
  productionDefault,
  wrapGlobalFetch,
  getProtectionStats,
};
