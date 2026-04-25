/**
 * CENTRALIZED CONSTANTS
 * All detection thresholds, time windows, and configuration values
 * Single source of truth for tunable parameters
 */

// Detection Engine Thresholds
export const DETECTION_THRESHOLDS = {
  // Kill switch activates at this danger score
  KILL_SWITCH: 90,

  // Loop detection: 3+ identical requests in 30 seconds
  LOOP_COUNT: 3,
  LOOP_WINDOW_MS: 30000, // 30 seconds

  // Duplicate detection: 1+ identical requests in 1 hour
  DUPLICATE_WINDOW_MS: 3600000, // 1 hour

  // Cost spike: $0.05+ per request
  COST_SPIKE_DOLLARS: 0.05,
  COST_SPIKE_BASE_SCORE: 30,
  COST_SPIKE_MULTIPLIER: 50,

  // Context explosion: context 5x+ larger than prompt
  CONTEXT_RATIO: 5,
  CONTEXT_EXPLOSION_BASE_SCORE: 25,
  CONTEXT_EXPLOSION_MULTIPLIER: 15,
  CONTEXT_EXPLOSION_MAX_SCORE: 75,

  // Fuzzy duplicate: 70%+ similarity
  FUZZY_SIMILARITY: 0.70,
  FUZZY_DUPLICATE_BASE_SCORE: 30,
  FUZZY_DUPLICATE_MULTIPLIER: 40,
  FUZZY_DUPLICATE_MAX_SCORE: 70,

  // Duplicate danger escalation
  DUPLICATE_BASE_SCORE: 40,
  DUPLICATE_MULTIPLIER: 10,
  DUPLICATE_MAX_SCORE: 90,

  // Loop danger escalation
  LOOP_BASE_SCORE: 90,
  LOOP_MULTIPLIER: 3,
  LOOP_MAX_SCORE: 100,

  // Absolute maximum danger score
  MAX_DANGER_SCORE: 100,
} as const;

// Time Windows for Analysis
export const TIME_WINDOWS = {
  // Recent history for loop detection
  LOOP: 30 * 1000, // 30 seconds

  // Recent history for duplicate detection
  DUPLICATE: 60 * 60 * 1000, // 1 hour

  // Default stats window
  STATS_DEFAULT_HOURS: 24,

  // Log retention
  LOG_RETENTION_DAYS: 30,

  // State cache expiration
  STATE_CACHE_HOURS: 24,
} as const;

// Rate Limiting
export const RATE_LIMITS = {
  // Default requests per minute per IP
  REQUESTS_PER_MINUTE: 60,

  // Retry-After header value (seconds)
  RETRY_AFTER_SECONDS: 60,

  // Rate limit window (ms)
  WINDOW_MS: 60000, // 1 minute
} as const;

// Proxy Configuration
export const PROXY_CONFIG = {
  // Default port
  DEFAULT_PORT: 3000,

  // Maximum request body size
  MAX_BODY_SIZE: '10mb',

  // Number of retries for failed requests
  MAX_RETRIES: 3,

  // Retry delay (ms)
  RETRY_DELAY_MS: 1000,

  // Exponential backoff multiplier
  BACKOFF_MULTIPLIER: 2,
} as const;

// Cost Calculation
export const COST_CALCULATION = {
  // Tokens per 1K for pricing calculations
  TOKENS_PER_UNIT: 1000,

  // Default output tokens for estimation
  DEFAULT_OUTPUT_TOKENS: 1000,

  // Minimum cost to consider
  MINIMUM_COST: 0,
} as const;

// Trust Modes - exported from userConfig.ts
export { TrustMode } from './userConfig';

export const TRUST_MODES = {
  MONITOR: 'monitor',
  WARN: 'warn',
  BLOCK: 'block',
} as const;

// Alert Categories
export const ALERT_CATEGORIES = {
  LOOP: 'loop',
  DUPLICATE: 'duplicate',
  FUZZY_DUPLICATE: 'fuzzy_duplicate',
  CONTEXT_EXPLOSION: 'context',
  COST_SPIKE: 'spike',
  SAFE: 'safe',
  INVALID: 'invalid',
  ANOMALY: 'anomaly',
} as const;

export type AlertCategory = typeof ALERT_CATEGORIES[keyof typeof ALERT_CATEGORIES];

// Decisions
export const DECISIONS = {
  ALLOW: 'allow',
  WARN: 'warn',
  BLOCK: 'block',
} as const;

export type Decision = typeof DECISIONS[keyof typeof DECISIONS];

// Severity Levels
export const SEVERITY = {
  SAFE: 'SAFE',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type Severity = typeof SEVERITY[keyof typeof SEVERITY];

// File Paths - Unified storage directory
export const PATHS = {
  // Unified application directory
  APP_DIR: '.aifw',

  // Config file
  CONFIG_FILE: 'config.json',

  // History file
  HISTORY_FILE: 'history.jsonl',

  // Log file
  LOG_FILE: 'logs.jsonl',
} as const;

// HTTP Status Codes Used
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

// Similarity Calculation
export const SIMILARITY = {
  // Maximum string length for comparison (performance)
  MAX_LENGTH: 500,

  // Exact match threshold
  EXACT: 1.0,

  // Minimum meaningful similarity
  MINIMUM: 0,
} as const;
