/**
 * Console logger utility that respects test environment
 * Silences logs during tests to reduce console spam
 */

export const logger = {
  log: (...args: any[]) => {
    if (process.env.NODE_ENV !== 'test') {
      console.log(...args);
    }
  },
  warn: (...args: any[]) => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    // Always log errors, even in tests
    console.error(...args);
  },
};
