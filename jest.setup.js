// Set test environment variable (for backward compatibility)
process.env.NODE_ENV = 'test';

// Configure logger to be silent during tests
// This is done BEFORE any imports to ensure all tests use silent logging
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Suppress console output during tests (errors still allowed)
console.log = () => {};
console.warn = () => {};
// console.error remains active for test debugging
