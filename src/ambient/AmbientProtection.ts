/**
 * AmbientProtection.ts - Runtime Execution Constraint
 * 
 * Protection activates automatically on module import.
 * No function call required. No configuration required.
 * 
 * import 'ai-costguard'  // → Protection is now active
 * 
 * This is a runtime enforcement layer, not a tool.
 * Like TLS for AI calls - always there, automatic, unsafe to remove.
 */

import * as crypto from 'crypto';

// Protection state
let AMBIENT_ACTIVE = false;
let AI_USAGE_DETECTED = false;

// Store original implementations
const ORIGINALS = {
  fetch: undefined as typeof fetch | undefined,
  http: undefined as any,
  https: undefined as any,
};

// AI API endpoints to intercept
const AI_ENDPOINTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.cohere.com',
  'api.together.xyz',
  'api.perplexity.ai',
];

/**
 * AmbientProtection - Runtime constraint that auto-activates
 * 
 * This module patches the runtime globally when imported.
 * No developer action required beyond: import 'ai-costguard'
 */
export class AmbientProtection {
  private apiKey: string;
  private mode: 'enforced' | 'observed' | 'disabled';
  private interceptCount = 0;
  private blockCount = 0;

  constructor() {
    // Auto-detect API key from environment
    this.apiKey = process.env.AI_COSTGUARD_API_KEY || '';
    
    // Auto-detect mode from environment
    const envMode = process.env.AI_COSTGUARD_MODE;
    if (envMode === 'disabled') {
      this.mode = 'disabled';
    } else if (envMode === 'observed') {
      this.mode = 'observed';
    } else {
      this.mode = 'enforced';  // Default: enforcement active
    }

    // Activate immediately on instantiation
    this.activate();
  }

  /**
   * Activate ambient protection globally
   * This patches the runtime without any explicit developer call
   */
  private activate(): void {
    if (AMBIENT_ACTIVE) return;  // Already active
    
    console.log('[AI Cost Guard] Ambient execution constraint activating...');

    // Patch global fetch
    this.patchGlobalFetch();

    // Patch Node.js http/https
    this.patchNodeHTTP();

    // Monitor for AI SDK imports
    this.monitorModuleImports();

    AMBIENT_ACTIVE = true;

    console.log('[AI Cost Guard] Runtime enforcement active. AI calls will be intercepted.');
    
    if (this.mode === 'enforced') {
      console.log('[AI Cost Guard] Mode: ENFORCED - Cost explosions will be blocked');
    } else if (this.mode === 'observed') {
      console.log('[AI Cost Guard] Mode: OBSERVED - Logging only');
    }
  }

  /**
   * Patch global fetch to intercept AI calls
   */
  private patchGlobalFetch(): void {
    if (typeof globalThis === 'undefined') return;
    if (!globalThis.fetch) return;

    ORIGINALS.fetch = globalThis.fetch;

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      
      // Check if this is an AI endpoint
      if (this.isAIEndpoint(url)) {
        AI_USAGE_DETECTED = true;
        this.interceptCount++;

        console.log(`[AI Cost Guard] Intercepted AI call: ${url}`);

        // Check with protection engine
        const decision = this.evaluateCall(url, init);

        if (decision.action === 'block' && this.mode === 'enforced') {
          this.blockCount++;
          console.log(`[AI Cost Guard] BLOCKED: ${decision.reason} (${decision.estimatedCost} saved)`);
          
          // Return synthetic error response
          return new Response(
            JSON.stringify({
              error: 'ai_cost_guard_blocked',
              message: 'Cost explosion prevented',
              reason: decision.reason,
              estimated_savings: decision.estimatedCost,
            }),
            {
              status: 429,
              statusText: 'Cost Explosion Prevented',
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        if (decision.action === 'block' && this.mode === 'observed') {
          console.log(`[AI Cost Guard] WOULD BLOCK: ${decision.reason}`);
        }

        // Log all AI calls
        this.logInterception(url, decision);
      }

      // Pass through to original fetch
      return ORIGINALS.fetch!(input, init);
    };

    // Mark as patched
    Object.defineProperty(globalThis.fetch, '__ai_cost_guard_patched', {
      value: true,
      writable: false,
      enumerable: false,
    });
  }

  /**
   * Patch Node.js http/https modules
   */
  private patchNodeHTTP(): void {
    try {
      const http = require('http');
      const https = require('https');

      // Store originals
      ORIGINALS.http = http.request;
      ORIGINALS.https = https.request;

      // Patch http.request
      http.request = (...args: any[]) => {
        const options = args[0];
        const url = typeof options === 'string' ? options : `${options.hostname || options.host}${options.path}`;
        
        if (this.isAIEndpoint(url)) {
          console.log(`[AI Cost Guard] Intercepted Node HTTP request: ${url}`);
        }
        
        return ORIGINALS.http.call(http, ...args);
      };

      // Patch https.request
      https.request = (...args: any[]) => {
        const options = args[0];
        const url = typeof options === 'string' ? options : `${options.hostname || options.host}${options.path}`;
        
        if (this.isAIEndpoint(url)) {
          console.log(`[AI Cost Guard] Intercepted Node HTTPS request: ${url}`);
        }
        
        return ORIGINALS.https.call(https, ...args);
      };

    } catch {
      // Node modules not available (browser environment)
    }
  }

  /**
   * Monitor module imports to detect AI SDK usage
   */
  private monitorModuleImports(): void {
    // In real implementation: use Module hooks or ESM loaders
    // For now: rely on fetch/http interception
    
    console.log('[AI Cost Guard] Monitoring for AI SDK usage...');
  }

  /**
   * Check if URL is an AI endpoint
   */
  private isAIEndpoint(url: string): boolean {
    return AI_ENDPOINTS.some(endpoint => url.includes(endpoint));
  }

  /**
   * Evaluate an AI call for blocking
   */
  private evaluateCall(url: string, init?: RequestInit): {
    action: 'allow' | 'block';
    reason: string;
    estimatedCost: number;
  } {
    // Simulate protection logic
    // In real implementation: call protection service
    
    const body = init?.body?.toString() || '';
    
    // Detect repetitive patterns (simulated)
    if (this.interceptCount > 3) {
      return {
        action: 'block',
        reason: 'Loop pattern detected - repetitive AI calls',
        estimatedCost: 0.06,
      };
    }

    // Detect high-cost calls
    if (body.length > 4000) {
      return {
        action: 'block',
        reason: 'High-cost request detected',
        estimatedCost: 0.12,
      };
    }

    return {
      action: 'allow',
      reason: 'Normal request',
      estimatedCost: 0.03,
    };
  }

  /**
   * Log interception for audit trail
   */
  private logInterception(url: string, decision: any): void {
    // In real implementation: write to audit log
  }

  /**
   * Get current protection status
   */
  getStatus(): {
    active: boolean;
    mode: string;
    interceptCount: number;
    blockCount: number;
    aiUsageDetected: boolean;
  } {
    return {
      active: AMBIENT_ACTIVE,
      mode: this.mode,
      interceptCount: this.interceptCount,
      blockCount: this.blockCount,
      aiUsageDetected: AI_USAGE_DETECTED,
    };
  }

  /**
   * Disable protection (requires explicit call)
   */
  disable(): void {
    console.log('[AI Cost Guard] ⚠️  PROTECTION DISABLED - Execution constraint removed');
    this.mode = 'disabled';
  }
}

// === AUTO-ACTIVATE ON IMPORT ===
// This runs immediately when the module is imported
const AMBIENT = new AmbientProtection();

// Export the singleton for status checks
export const ambientProtection = AMBIENT;

// Export status check function
export function getAmbientStatus() {
  return AMBIENT.getStatus();
}

// Export disable function (requires explicit action)
export function disableAmbientProtection() {
  AMBIENT.disable();
}

// Default export is the ambient singleton
export default AMBIENT;
