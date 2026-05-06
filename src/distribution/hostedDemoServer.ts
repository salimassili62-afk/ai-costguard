/**
 * hostedDemoServer.ts - Lightweight HTTP Demo Server
 * 
 * Routes:
 * - GET /demo → Interactive demo page
 * - GET /demo/:id → Replay specific run
 * - GET /share/:id → Shareable link preview
 * 
 * Enables self-serve product trial without installation.
 */

import * as http from 'http';
import * as url from 'url';
import { demoLinkGenerator, DEMO_SCENARIOS } from './demoLinkGenerator';
import { generateDemoHTML, generateDemoJSON } from './publicDemoPage';
import { generateViralPayload } from './viralPayloadFormatter';

export interface DemoServerConfig {
  port: number;
  host: string;
  baseUrl: string;
  enableCors: boolean;
  maxRequestsPerMinute: number;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * HostedDemoServer - Self-serve demo without installation
 * 
 * Distribution mechanism:
 * 1. User visits /demo → sees interactive scenarios
 * 2. User picks scenario → sees simulation
 * 3. User gets shareable link → can share results
 * 4. Recipients view at /demo/:id → viral loop
 */
export class HostedDemoServer {
  private server: http.Server | null = null;
  private config: DemoServerConfig;
  private rateLimits: Map<string, RateLimitEntry> = new Map();

  constructor(config?: Partial<DemoServerConfig>) {
    this.config = {
      port: 3001,
      host: 'localhost',
      baseUrl: 'http://localhost:3001',
      enableCors: true,
      maxRequestsPerMinute: 60,
      ...config,
    };
  }

  /**
   * Start the demo server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          console.error('Request handler error:', err);
          this.sendError(res, 500, 'Internal server error');
        });
      });

      this.server.listen(this.config.port, this.config.host, () => {
        console.log(`🎯 Demo server running at ${this.config.baseUrl}`);
        console.log(`   Interactive demo: ${this.config.baseUrl}/demo`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the demo server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Demo server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server URL
   */
  getUrl(): string {
    return this.config.baseUrl;
  }

  // Private request handler

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS headers
    if (this.config.enableCors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Rate limiting
    const clientIp = this.getClientIp(req);
    if (this.isRateLimited(clientIp)) {
      this.sendError(res, 429, 'Rate limit exceeded. Please try again later.');
      return;
    }

    // Parse URL
    const parsedUrl = url.parse(req.url || '/', true);
    const pathname = parsedUrl.pathname || '/';

    // Route handling
    try {
      if (pathname === '/' || pathname === '/demo') {
        await this.handleDemoList(req, res);
      } else if (pathname.startsWith('/demo/') && pathname.length > 6) {
        const sessionId = pathname.split('/')[2];
        await this.handleDemoView(req, res, sessionId);
      } else if (pathname.startsWith('/api/demo/create')) {
        await this.handleDemoCreate(req, res, parsedUrl.query);
      } else if (pathname.startsWith('/share/')) {
        const sessionId = pathname.split('/')[2];
        await this.handleShareView(req, res, sessionId);
      } else if (pathname === '/api/scenarios') {
        await this.handleScenariosList(req, res);
      } else if (pathname.startsWith('/api/share/')) {
        const sessionId = pathname.split('/')[3];
        await this.handleShareAPI(req, res, sessionId);
      } else {
        this.sendError(res, 404, 'Not found');
      }
    } catch (error) {
      console.error('Route handler error:', error);
      this.sendError(res, 500, 'Internal server error');
    }
  }

  // Route handlers

  private async handleDemoList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const html = generateDemoHTML({
      title: 'AI Cost Explosion Prevention - Interactive Demo',
      scenarios: DEMO_SCENARIOS,
      baseUrl: this.config.baseUrl,
    });

    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
  }

  private async handleDemoView(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
    const session = demoLinkGenerator.getSession(sessionId);

    if (!session) {
      this.sendError(res, 404, 'Demo session not found');
      return;
    }

    // Check Accept header for JSON vs HTML
    const acceptHeader = req.headers.accept || '';
    
    if (acceptHeader.includes('application/json')) {
      // JSON API response
      const json = generateDemoJSON(session);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify(json, null, 2));
    } else {
      // HTML page response
      const html = generateDemoHTML({
        title: `${session.title} - Demo Results`,
        session,
        baseUrl: this.config.baseUrl,
        shareable: true,
      });

      res.setHeader('Content-Type', 'text/html');
      res.writeHead(200);
      res.end(html);
    }
  }

  private async handleDemoCreate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    query: url.UrlWithParsedQuery['query']
  ): Promise<void> {
    const scenarioName = query.scenario as string;
    
    const session = demoLinkGenerator.createDemoSession(scenarioName || DEMO_SCENARIOS[0].name, {
      title: query.title as string,
      description: query.description as string,
    });

    const link = demoLinkGenerator.getShareableLink(session.id, this.config.baseUrl);

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(201);
    res.end(JSON.stringify({
      sessionId: session.id,
      url: link?.url,
      summary: session.summary,
      expiresAt: session.expiresAt,
    }, null, 2));
  }

  private async handleShareView(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
    const session = demoLinkGenerator.getSession(sessionId);

    if (!session) {
      this.sendError(res, 404, 'Share link not found');
      return;
    }

    // Generate shareable preview (simpler than full demo)
    const html = generateDemoHTML({
      title: `${session.title} - Share`,
      session,
      baseUrl: this.config.baseUrl,
      shareable: true,
      minimal: true,
    });

    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
  }

  private async handleScenariosList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({
      scenarios: DEMO_SCENARIOS.map(s => ({
        name: s.name,
        description: s.description,
        agentType: s.agentType,
        model: s.model,
        requestCount: s.requestCount,
        avgRequestCost: s.avgRequestCost,
      })),
    }, null, 2));
  }

  private async handleShareAPI(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
    const session = demoLinkGenerator.getSession(sessionId);

    if (!session) {
      this.sendError(res, 404, 'Session not found');
      return;
    }

    // Generate viral payload for sharing
    const payload = generateViralPayload(session);

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(payload, null, 2));
  }

  // Helper methods

  private sendError(res: http.ServerResponse, code: number, message: string): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(code);
    res.end(JSON.stringify({ error: message, code }, null, 2));
  }

  private getClientIp(req: http.IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  private isRateLimited(clientIp: string): boolean {
    const now = Date.now();
    const windowMs = 60000; // 1 minute

    const entry = this.rateLimits.get(clientIp);
    
    if (!entry || now > entry.resetTime) {
      this.rateLimits.set(clientIp, { count: 1, resetTime: now + windowMs });
      return false;
    }

    entry.count++;
    
    if (entry.count > this.config.maxRequestsPerMinute) {
      return true;
    }

    return false;
  }
}

// Singleton instance
export const hostedDemoServer = new HostedDemoServer();

// Convenience exports
export async function startDemoServer(config?: Partial<DemoServerConfig>): Promise<HostedDemoServer> {
  const server = new HostedDemoServer(config);
  await server.start();
  return server;
}

export async function stopDemoServer(): Promise<void> {
  return hostedDemoServer.stop();
}

export function getDemoServerUrl(): string {
  return hostedDemoServer.getUrl();
}
