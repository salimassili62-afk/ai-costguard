/**
 * Production-grade Logger with explicit log levels
 * 
 * Design principles:
 * - No environment-based silencing (NODE_ENV, etc.)
 * - Explicit log level configuration
 * - Deterministic behavior regardless of environment
 * - Default level: info (for production/CLI)
 * - Default level: warn (for tests - configured in test setup)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  debug(...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log('[DEBUG]', ...args);
    }
  }

  info(...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(...args);
    }
  }

  warn(...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn('[WARN]', ...args);
    }
  }

  error(...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error('[ERROR]', ...args);
    }
  }
}

// Global logger instance - defaults to 'info' for production
export const logger = new Logger('info');

// For tests - create a silent logger
export function createSilentLogger(): Logger {
  return new Logger('silent');
}

// For debugging - create a verbose logger
export function createDebugLogger(): Logger {
  return new Logger('debug');
}

// Re-export Logger class for custom instances
export { Logger };
