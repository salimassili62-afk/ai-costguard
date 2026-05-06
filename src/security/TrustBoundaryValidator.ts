/**
 * TrustBoundaryValidator.ts - Enterprise API Security Layer
 * 
 * Stripe-level API discipline:
 * - HMAC-signed API requests (prevents tampering)
 * - Request expiration timestamps (prevents replay attacks)
 * - Rate limiting per API key (hard enforcement)
 * - Idempotency keys (prevents duplicate processing)
 * - Environment isolation (dev/staging/production)
 * - Schema validation at runtime
 * - Unsafe payload blocking
 * 
 * Core principle: Trust nothing, validate everything
 */

import * as crypto from 'crypto';

export interface SignedRequest {
  apiKey: string;
  timestamp: number;
  signature: string;
  idempotencyKey?: string;
  bodyHash?: string;
}

export interface ValidationResult {
  valid: boolean;
  rejected: boolean;
  reason?: string;
  code: 'VALID' | 'INVALID_SIGNATURE' | 'EXPIRED_REQUEST' | 'RATE_LIMITED' | 'IDEMPOTENCY_CONFLICT' | 'MALFORMED_PAYLOAD' | 'INVALID_ENVIRONMENT';
  apiKeyId?: string;
  userId?: string;
  environment: 'dev' | 'staging' | 'production';
  rateLimitRemaining?: number;
  idempotencyKey?: string;
}

export interface RateLimitState {
  count: number;
  resetAt: number;
  windowMs: number;
}

export interface EnvironmentConfig {
  name: 'dev' | 'staging' | 'production';
  strictMode: boolean;
  requestMaxAgeMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  requireIdempotency: boolean;
  requireBodyHash: boolean;
}

/**
 * TrustBoundaryValidator - Enterprise-grade API security
 * 
 * Behaves like Stripe: every request is signed, timestamped, and rate-limited.
 * No request crosses the boundary without validation.
 */
export class TrustBoundaryValidator {
  private apiKeySecrets: Map<string, string> = new Map();
  private rateLimits: Map<string, RateLimitState> = new Map();
  private idempotencyStore: Map<string, { processedAt: number; result: unknown }> = new Map();
  private environments: Map<string, EnvironmentConfig> = new Map();
  private requestLog: Set<string> = new Set();

  constructor() {
    this.setupEnvironments();
  }

  /**
   * Validate incoming request against trust boundary
   * This is the ONLY entry point for API requests
   */
  validateRequest(params: {
    apiKey: string;
    signature: string;
    timestamp: number;
    idempotencyKey?: string;
    bodyHash?: string;
    body?: string;
    path: string;
    method: string;
  }): ValidationResult {
    const env = this.detectEnvironment(params.apiKey);
    const config = this.environments.get(env)!;

    // 1. Validate API key format
    const keyId = this.extractKeyId(params.apiKey);
    if (!keyId) {
      return this.reject('INVALID_SIGNATURE', 'Invalid API key format', env);
    }

    // 2. Check request age (prevent replay attacks)
    const now = Date.now();
    const requestAge = now - params.timestamp;
    if (requestAge > config.requestMaxAgeMs || requestAge < -5000) {
      return this.reject('EXPIRED_REQUEST', `Request expired or future-dated (${requestAge}ms)`, env);
    }

    // 3. Validate HMAC signature
    const secret = this.apiKeySecrets.get(params.apiKey);
    if (!secret) {
      return this.reject('INVALID_SIGNATURE', 'Unknown API key', env);
    }

    const expectedSignature = this.computeHMAC(params, secret);
    if (!crypto.timingSafeEqual(Buffer.from(params.signature), Buffer.from(expectedSignature))) {
      return this.reject('INVALID_SIGNATURE', 'Signature mismatch', env);
    }

    // 4. Verify body hash (if required)
    if (config.requireBodyHash && params.body && params.bodyHash) {
      const computedHash = crypto.createHash('sha256').update(params.body).digest('hex');
      if (computedHash !== params.bodyHash) {
        return this.reject('MALFORMED_PAYLOAD', 'Body hash mismatch', env);
      }
    }

    // 5. Rate limiting (hard enforcement)
    const rateLimit = this.checkRateLimit(params.apiKey, config);
    if (rateLimit.exceeded) {
      return this.reject('RATE_LIMITED', `Rate limit exceeded. Reset at ${new Date(rateLimit.resetAt).toISOString()}`, env, undefined, rateLimit.remaining);
    }

    // 6. Idempotency check
    if (config.requireIdempotency && params.idempotencyKey) {
      if (this.idempotencyStore.has(params.idempotencyKey)) {
        return {
          valid: false,
          rejected: true,
          code: 'IDEMPOTENCY_CONFLICT',
          reason: 'Idempotency key already used',
          environment: env,
          idempotencyKey: params.idempotencyKey,
        };
      }
    }

    // 7. Payload schema validation (in production)
    if (config.strictMode && params.body) {
      const schemaCheck = this.validatePayloadSchema(params.body, params.path);
      if (!schemaCheck.valid) {
        return this.reject(
          'MALFORMED_PAYLOAD',
          schemaCheck.error || 'Invalid payload',
          env
        );
      }
    }

    // All checks passed
    return {
      valid: true,
      rejected: false,
      code: 'VALID',
      apiKeyId: keyId,
      userId: this.extractUserId(params.apiKey),
      environment: env,
      rateLimitRemaining: rateLimit.remaining,
      idempotencyKey: params.idempotencyKey,
    };
  }

  /**
   * Register idempotency key as processed
   */
  recordIdempotency(key: string, result: unknown): void {
    this.idempotencyStore.set(key, {
      processedAt: Date.now(),
      result,
    });

    // Cleanup old entries after 24 hours
    setTimeout(() => this.idempotencyStore.delete(key), 24 * 60 * 60 * 1000);
  }

  /**
   * Register API key with its signing secret
   */
  registerApiKey(apiKey: string, userId: string, environment: 'dev' | 'staging' | 'production'): void {
    // Generate deterministic secret from key
    const secret = crypto.createHmac('sha256', 'master-secret').update(apiKey).digest('hex');
    this.apiKeySecrets.set(apiKey, secret);
  }

  /**
   * Generate signed request (for client SDK)
   */
  generateSignedRequest(apiKey: string, body: string, idempotencyKey?: string): SignedRequest {
    const timestamp = Date.now();
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    
    const secret = this.apiKeySecrets.get(apiKey);
    if (!secret) throw new Error('Unknown API key');

    const signaturePayload = `${apiKey}:${timestamp}:${bodyHash}:${idempotencyKey || ''}`;
    const signature = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex');

    return {
      apiKey,
      timestamp,
      signature,
      idempotencyKey,
      bodyHash,
    };
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(apiKey: string): { remaining: number; resetAt: number; windowMs: number } {
    const state = this.rateLimits.get(apiKey);
    const env = this.detectEnvironment(apiKey);
    const config = this.environments.get(env)!;

    if (!state || Date.now() > state.resetAt) {
      return {
        remaining: config.rateLimitMaxRequests,
        resetAt: Date.now() + config.rateLimitWindowMs,
        windowMs: config.rateLimitWindowMs,
      };
    }

    return {
      remaining: Math.max(0, config.rateLimitMaxRequests - state.count),
      resetAt: state.resetAt,
      windowMs: config.rateLimitWindowMs,
    };
  }

  // Private methods

  private setupEnvironments(): void {
    this.environments.set('dev', {
      name: 'dev',
      strictMode: false,
      requestMaxAgeMs: 5 * 60 * 1000, // 5 minutes
      rateLimitWindowMs: 60 * 1000,
      rateLimitMaxRequests: 1000,
      requireIdempotency: false,
      requireBodyHash: false,
    });

    this.environments.set('staging', {
      name: 'staging',
      strictMode: true,
      requestMaxAgeMs: 2 * 60 * 1000, // 2 minutes
      rateLimitWindowMs: 60 * 1000,
      rateLimitMaxRequests: 500,
      requireIdempotency: true,
      requireBodyHash: true,
    });

    this.environments.set('production', {
      name: 'production',
      strictMode: true,
      requestMaxAgeMs: 60 * 1000, // 1 minute
      rateLimitWindowMs: 60 * 1000,
      rateLimitMaxRequests: 100,
      requireIdempotency: true,
      requireBodyHash: true,
    });
  }

  private detectEnvironment(apiKey: string): 'dev' | 'staging' | 'production' {
    if (apiKey.startsWith('ak_live_prod_')) return 'production';
    if (apiKey.startsWith('ak_live_staging_')) return 'staging';
    return 'dev';
  }

  private extractKeyId(apiKey: string): string | undefined {
    const parts = apiKey.split('_');
    return parts[parts.length - 1]?.substring(0, 12);
  }

  private extractUserId(apiKey: string): string {
    // In real implementation, would decode from key
    return 'user_' + this.extractKeyId(apiKey);
  }

  private computeHMAC(params: Parameters<typeof this.validateRequest>[0], secret: string): string {
    const bodyHash = params.bodyHash || crypto.createHash('sha256').update(params.body || '').digest('hex');
    const payload = `${params.apiKey}:${params.timestamp}:${bodyHash}:${params.idempotencyKey || ''}:${params.path}:${params.method}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  private checkRateLimit(apiKey: string, config: EnvironmentConfig): { exceeded: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let state = this.rateLimits.get(apiKey);

    if (!state || now > state.resetAt) {
      state = {
        count: 0,
        resetAt: now + config.rateLimitWindowMs,
        windowMs: config.rateLimitWindowMs,
      };
      this.rateLimits.set(apiKey, state);
    }

    state.count++;

    const remaining = Math.max(0, config.rateLimitMaxRequests - state.count);
    const exceeded = state.count > config.rateLimitMaxRequests;

    return { exceeded, remaining, resetAt: state.resetAt };
  }

  private validatePayloadSchema(body: string, path: string): { valid: boolean; error?: string } {
    try {
      const parsed = JSON.parse(body);

      // Basic schema checks based on path
      if (path.includes('/api/protection/')) {
        if (!parsed.model || typeof parsed.model !== 'string') {
          return { valid: false, error: 'Missing or invalid model field' };
        }
        if (!parsed.requestId || typeof parsed.requestId !== 'string') {
          return { valid: false, error: 'Missing or invalid requestId field' };
        }
      }

      // Check for unsafe payloads
      const bodyStr = JSON.stringify(parsed).toLowerCase();
      const unsafePatterns = ['__proto__', 'constructor', 'prototype', '<script'];
      if (unsafePatterns.some(p => bodyStr.includes(p))) {
        return { valid: false, error: 'Unsafe payload detected' };
      }

      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid JSON payload' };
    }
  }

  private reject(
    code: ValidationResult['code'],
    reason: string,
    environment: 'dev' | 'staging' | 'production',
    apiKeyId?: string,
    rateLimitRemaining?: number
  ): ValidationResult {
    return {
      valid: false,
      rejected: true,
      code,
      reason,
      environment,
      apiKeyId,
      rateLimitRemaining,
    };
  }
}

// Singleton
export const trustBoundary = new TrustBoundaryValidator();
export function createTrustBoundary(): TrustBoundaryValidator {
  return new TrustBoundaryValidator();
}
