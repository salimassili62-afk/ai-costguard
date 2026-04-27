/**
 * AI Execution Firewall - Express Middleware Example
 *
 * Shows how to add automatic AI request protection to an Express application.
 */

import express, { Request, Response } from 'express';
import { expressFirewall, withFirewallHandler, getFirewallStats } from '../src/wrapper/aiFirewall';
import { detectionEngine } from '../src/core/DetectionEngine';

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// ============================================================================
// Method 1: Global Firewall Middleware (protects all AI endpoints)
// ============================================================================
app.use(
  expressFirewall({
    trustMode: 'block', // 'monitor' | 'warn' | 'block'

    // Custom paths to protect (optional - defaults cover OpenAI/Anthropic paths)
    paths: ['/v1/chat/completions', '/api/ai', '/v1/messages'],

    // Called when a request is blocked
    onBlock: (req: Request, res: Response, reason: string, dangerScore: number) => {
      console.log(`🔴 Blocked ${req.path}: ${reason} (score: ${dangerScore})`);

      res.status(403).json({
        error: 'Request blocked by AI Execution Firewall',
        reason,
        dangerScore,
        path: req.path,
        timestamp: new Date().toISOString(),
      });
    },

    // Called when a request triggers a warning
    onWarn: (req: Request, reason: string, dangerScore: number) => {
      console.log(`⚠️  Warning for ${req.path}: ${reason} (score: ${dangerScore})`);
    },

    // Called when a request is allowed
    onAllow: (req: Request) => {
      console.log(`✅ Allowed ${req.path}`);
    },
  })
);

// ============================================================================
// Protected AI Endpoints
// ============================================================================

// OpenAI-compatible endpoint
app.post('/v1/chat/completions', async (req: Request, res: Response) => {
  // This will only be reached if the firewall allows the request
  console.log('Processing chat completion:', req.body.model);

  // Forward to actual AI service (simplified example)
  res.json({
    id: 'chatcmpl-' + Date.now(),
    object: 'chat.completion',
    model: req.body.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'This is a simulated response. In production, forward to OpenAI.',
        },
        finish_reason: 'stop',
      },
    ],
  });
});

// Anthropic-compatible endpoint
app.post('/v1/messages', async (req: Request, res: Response) => {
  console.log('Processing Anthropic message:', req.body.model);

  res.json({
    id: 'msg_' + Date.now(),
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Simulated Anthropic response.' }],
    model: req.body.model,
  });
});

// Custom AI endpoint
app.post('/api/ai/generate', async (req: Request, res: Response) => {
  console.log('Processing custom AI request');

  res.json({
    generated: true,
    content: 'Custom AI response here.',
    safetyChecked: true,
  });
});

// ============================================================================
// Method 2: Route-specific Firewall (granular control)
// ============================================================================

app.post(
  '/api/sensitive-ai',
  withFirewallHandler(
    async (req: Request, res: Response) => {
      // This handler only runs if the firewall allows the request
      res.json({
        result: 'Sensitive operation completed',
        requestId: req.headers['x-request-id'],
      });
    },
    {
      trustMode: 'block', // Stricter mode for sensitive endpoint
      onBlock: (req, res, reason) => {
        res.status(403).json({
          error: 'Sensitive operation blocked',
          reason,
          contact: 'security@company.com',
        });
      },
    }
  )
);

// ============================================================================
// Health & Monitoring Endpoints
// ============================================================================

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'AI Execution Firewall',
    timestamp: new Date().toISOString(),
  });
});

app.get('/firewall/stats', async (req: Request, res: Response) => {
  const hours = parseInt(req.query.hours as string) || 24;
  const stats = await getFirewallStats(hours);

  res.json({
    ...stats,
    protectionActive: true,
    trustMode: 'block',
  });
});

app.get('/firewall/blocked', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const blocked = detectionEngine.getBlocked(limit);

  res.json({
    blocked,
    count: blocked.length,
  });
});

// ============================================================================
// Error Handling
// ============================================================================

app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Express error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// ============================================================================
// Server Startup
// ============================================================================

app.listen(PORT, () => {
  console.log(`
🛡️  AI Execution Firewall Express Server
==========================================
Server running on port ${PORT}

Protected endpoints:
  POST /v1/chat/completions  (OpenAI-compatible)
  POST /v1/messages          (Anthropic-compatible)
  POST /api/ai/generate      (Custom AI endpoint)
  POST /api/sensitive-ai     (High-security endpoint)

Monitoring:
  GET  /health               (Health check)
  GET  /firewall/stats       (Protection statistics)
  GET  /firewall/blocked     (Recently blocked requests)

Example request:
  curl -X POST http://localhost:${PORT}/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
`);
});

export { app };
