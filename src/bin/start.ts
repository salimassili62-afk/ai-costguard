#!/usr/bin/env node

/**
 * AI Execution Firewall - Server Entrypoint
 *
 * This is the standalone entrypoint for starting the proxy server.
 * It handles CLI argument parsing and server lifecycle.
 *
 * Usage:
 *   node dist/bin/start.js
 *   node dist/bin/start.js --port 3000
 *   PORT=3000 node dist/bin/start.js
 */

import { ProxyServer } from '../proxy';

// Parse command line arguments
const args = process.argv.slice(2);
let port: number | undefined;

// Check for --port or -p argument
const portIndex = args.findIndex((arg) => arg === '--port' || arg === '-p');
if (portIndex !== -1 && args[portIndex + 1]) {
  port = parseInt(args[portIndex + 1], 10);
}

// Fallback to environment variable or default
port = port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);

// Validate port
if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`[AI Firewall] Error: Invalid port number: ${port}`);
  console.error('[AI Firewall] Port must be between 1 and 65535');
  process.exit(1);
}

// Ensure logging is enabled for CLI mode
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Start the server
const server = new ProxyServer(port);

server
  .start()
  .then(() => {
    console.log(`[AI Firewall] Server initialized successfully on port ${port}`);
    console.log(`[AI Firewall] Health check: http://localhost:${port}/health`);
  })
  .catch((err) => {
    console.error('[AI Firewall] Startup failed:', err);
    process.exit(1);
  });

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[AI Firewall] Received SIGTERM, shutting down gracefully...');
  server.stop().then(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[AI Firewall] Received SIGINT, shutting down gracefully...');
  server.stop().then(() => process.exit(0));
});
