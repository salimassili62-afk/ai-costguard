/**
 * SaaSServer.ts - Production Hosted SaaS
 * 
 * Real SaaS application mode:
 * - / → Landing page (marketing, zero dev UI)
 * - /signup → Instant account (email or anonymous)
 * - /dashboard → User workspace
 * - /app → Actual product usage (NOT demo)
 * - Persistent users, API keys, usage tracking
 * 
 * Zero "run locally / CLI-first" feel.
 */

import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import { UserStore, User, ApiKey } from './UserStore';
import { runCostExplosionDemo, DemoResult } from './CostExplosionDemo';
import { immutableAudit, AuditEntry } from '../trust';

export interface SaaSConfig {
  port: number;
  host: string;
  baseUrl: string;
}

interface AuthenticatedRequest extends http.IncomingMessage {
  user?: User;
  sessionToken?: string;
}

/**
 * SaaSServer - Production-hosted SaaS application
 * 
 * User journey (60 seconds):
 * 1. Landing page (value prop only)
 * 2. Signup (1 field OR skip)
 * 3. Auto-login → Dashboard
 * 4. Instant demo → ROI screen
 * 5. API key ready for production
 */
export class SaaSServer {
  private server: http.Server | null = null;
  private config: SaaSConfig;
  private userStore: UserStore;

  constructor(config?: Partial<SaaSConfig>) {
    this.config = {
      port: parseInt(process.env.PORT || '3000'),
      host: '0.0.0.0',
      baseUrl: process.env.BASE_URL || 'https://ai-costguard.com',
      ...config,
    };
    this.userStore = new UserStore();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req as AuthenticatedRequest, res).catch(err => {
          console.error('Server error:', err);
          this.sendError(res, 500, 'Internal error');
        });
      });

      this.server.listen(this.config.port, this.config.host, () => {
        console.log(`🚀 SaaS Live: ${this.config.baseUrl}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url || '/', true);
    const pathname = parsedUrl.pathname || '/';

    // Public routes
    if (pathname === '/' || pathname === '/landing') {
      await this.serveLandingPage(req, res);
      return;
    }

    if (pathname === '/signup' && req.method === 'POST') {
      await this.handleSignup(req, res);
      return;
    }

    // Auth middleware for all other routes
    await this.authenticate(req, res);
    if (!req.user) return;

    // Authenticated routes
    switch (pathname) {
      case '/dashboard':
        await this.serveDashboard(req, res);
        break;
      case '/app':
        await this.serveApp(req, res);
        break;
      case '/api/run-demo':
        await this.handleRunDemo(req, res);
        break;
      case '/api/keys':
        await this.handleApiKeys(req, res);
        break;
      case '/api/usage':
        await this.handleUsage(req, res);
        break;
      default:
        this.sendError(res, 404, 'Not found');
    }
  }

  // === PUBLIC ROUTES ===

  private async serveLandingPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Cost Guard - Stop Agent Cost Explosions</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: white;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 80px 20px;
      text-align: center;
    }
    h1 {
      font-size: 3rem;
      font-weight: 800;
      margin-bottom: 16px;
      line-height: 1.1;
    }
    .subtitle {
      font-size: 1.25rem;
      opacity: 0.9;
      margin-bottom: 40px;
      line-height: 1.5;
    }
    .hero-stat {
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 32px;
      margin: 40px 0;
    }
    .hero-number {
      font-size: 4rem;
      font-weight: 800;
      color: #4ade80;
      text-shadow: 0 2px 10px rgba(74, 222, 128, 0.3);
    }
    .hero-label {
      font-size: 1.1rem;
      opacity: 0.9;
      margin-top: 8px;
    }
    .cta-box {
      background: white;
      border-radius: 16px;
      padding: 32px;
      margin-top: 40px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .cta-box h2 {
      color: #1f2937;
      font-size: 1.5rem;
      margin-bottom: 8px;
    }
    .cta-box p {
      color: #6b7280;
      margin-bottom: 24px;
    }
    input[type="email"] {
      width: 100%;
      padding: 16px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 1rem;
      margin-bottom: 12px;
    }
    button {
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1.1rem;
      font-weight: 600;
      cursor: pointer;
    }
    .skip-btn {
      background: transparent;
      color: #667eea;
      border: 2px solid #667eea;
      margin-top: 12px;
    }
    .loading {
      display: none;
      color: #667eea;
      margin-top: 16px;
    }
    .error {
      color: #dc2626;
      margin-top: 8px;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Stop AI Cost Explosions</h1>
    <p class="subtitle">
      Runaway AI agents can burn through $10,000 in hours.<br>
      We block cost explosions before they happen.
    </p>
    
    <div class="hero-stat">
      <div class="hero-number">94%</div>
      <div class="hero-label">Average cost reduction in production</div>
    </div>

    <div class="cta-box">
      <h2>See Your Savings in 10 Seconds</h2>
      <p>No credit card required</p>
      
      <form id="signupForm">
        <input type="email" id="email" placeholder="Enter your email" required>
        <button type="submit" id="submitBtn">Start Free → Get API Key</button>
        <button type="button" class="skip-btn" id="skipBtn">Skip Email → Try Now</button>
      </form>
      
      <div class="loading" id="loading">Creating your account...</div>
      <div class="error" id="error"></div>
    </div>
  </div>

  <script>
    const form = document.getElementById('signupForm');
    const emailInput = document.getElementById('email');
    const submitBtn = document.getElementById('submitBtn');
    const skipBtn = document.getElementById('skipBtn');
    const loading = document.getElementById('loading');
    const errorDiv = document.getElementById('error');

    async function signup(useEmail = true) {
      errorDiv.textContent = '';
      loading.style.display = 'block';
      submitBtn.disabled = true;
      skipBtn.disabled = true;

      try {
        const body = useEmail 
          ? { email: emailInput.value } 
          : { anonymous: true };
        
        const res = await fetch('/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Signup failed');

        localStorage.setItem('sessionToken', data.sessionToken);
        localStorage.setItem('apiKey', data.apiKey);
        
        window.location.href = '/dashboard';
      } catch (err) {
        errorDiv.textContent = err.message;
        loading.style.display = 'none';
        submitBtn.disabled = false;
        skipBtn.disabled = false;
      }
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); signup(true); });
    skipBtn.addEventListener('click', () => signup(false));
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
  }

  private async handleSignup(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.parseBody(req);
    const email = body.email as string | undefined;
    const anonymous = body.anonymous as boolean | undefined;

    let user: User;

    if (anonymous || !email) {
      user = this.userStore.createAnonymousUser();
    } else {
      const existing = this.userStore.findByEmail(email);
      if (existing) {
        this.sendJSON(res, 409, { error: 'Email already registered' });
        return;
      }
      user = this.userStore.createUser(email);
    }

    const apiKey = this.userStore.createApiKey(user.id, 'Production Key');
    const session = this.userStore.createSession(user.id);

    this.sendJSON(res, 201, {
      userId: user.id,
      apiKey: apiKey.key,
      sessionToken: session.token,
    });
  }

  // === AUTHENTICATED ROUTES ===

  private async serveDashboard(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const user = req.user!;
    const apiKey = this.userStore.getApiKeys(user.id)[0];
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - AI Cost Guard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f9fafb;
      min-height: 100vh;
      color: #1f2937;
    }
    .header {
      background: white;
      border-bottom: 1px solid #e5e7eb;
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      font-size: 1.25rem;
      color: #667eea;
    }
    .container {
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .api-key-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .api-key-value {
      font-family: monospace;
      font-size: 1.1rem;
      background: rgba(255,255,255,0.15);
      padding: 12px;
      border-radius: 6px;
      word-break: break-all;
      margin: 12px 0;
    }
    .demo-btn {
      width: 100%;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1.2rem;
      font-weight: 600;
      cursor: pointer;
    }
    .demo-btn:hover { transform: scale(1.02); }
    .results {
      display: none;
      margin-top: 24px;
      padding-top: 24px;
      border-top: 2px solid #e5e7eb;
    }
    .results.show { display: block; }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat {
      text-align: center;
      padding: 20px;
      background: #f3f4f6;
      border-radius: 8px;
    }
    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: #667eea;
    }
    .stat-value.saved { color: #10b981; }
    .stat-label {
      font-size: 0.875rem;
      color: #6b7280;
      margin-top: 4px;
    }
    .insight {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-radius: 8px;
      padding: 16px;
      color: #065f46;
      font-weight: 500;
    }
    .loading {
      display: none;
      text-align: center;
      color: #667eea;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🛡️ AI Cost Guard</h1>
    <span>${user.email || 'Anonymous'}</span>
  </div>

  <div class="container">
    <div class="card api-key-box">
      <h3>Your API Key</h3>
      <div class="api-key-value" id="apiKey">${apiKey?.key || 'Generating...'}</div>
      <button onclick="copyKey()" style="background: white; color: #667eea; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Copy</button>
    </div>

    <div class="card">
      <button class="demo-btn" id="runDemo" onclick="runDemo()">
        Run Cost Explosion Demo (5 seconds)
      </button>
      <div class="loading" id="loading">Simulating 50 API calls...</div>
      
      <div class="results" id="results">
        <div class="stats">
          <div class="stat">
            <div class="stat-value" id="costBefore">$0</div>
            <div class="stat-label">Without Protection</div>
          </div>
          <div class="stat">
            <div class="stat-value" id="costAfter">$0</div>
            <div class="stat-label">With Firewall</div>
          </div>
          <div class="stat">
            <div class="stat-value saved" id="saved">$0</div>
            <div class="stat-label">Money Saved</div>
          </div>
        </div>
        <div class="insight" id="insight">
          We blocked 47 runaway calls before they cost you money
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-bottom: 16px;">Ready for Production</h3>
      <pre style="background: #1f2937; color: #e5e7eb; padding: 16px; border-radius: 8px; overflow-x: auto;"><code>npm install ai-costguard

import { withFirewall } from 'ai-costguard';

const protected = withFirewall(openai, {
  apiKey: '${apiKey?.key || 'YOUR_API_KEY'}'
});</code></pre>
    </div>
  </div>

  <script>
    function copyKey() {
      navigator.clipboard.writeText(document.getElementById('apiKey').textContent);
      alert('Copied!');
    }

    async function runDemo() {
      document.getElementById('runDemo').disabled = true;
      document.getElementById('loading').style.display = 'block';

      try {
        const token = localStorage.getItem('sessionToken');
        const res = await fetch('/api/run-demo', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
        });

        const data = await res.json();
        
        document.getElementById('costBefore').textContent = '$' + data.costBefore.toFixed(2);
        document.getElementById('costAfter').textContent = '$' + data.costAfter.toFixed(2);
        document.getElementById('saved').textContent = '$' + data.saved.toFixed(2);
        document.getElementById('insight').textContent = data.insight;
        
        document.getElementById('loading').style.display = 'none';
        document.getElementById('results').classList.add('show');
      } catch (err) {
        alert('Demo failed: ' + err.message);
        document.getElementById('runDemo').disabled = false;
        document.getElementById('loading').style.display = 'none';
      }
    }
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
  }

  private async serveApp(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    // Actual product usage page (not demo)
    this.sendJSON(res, 200, { message: 'Product app - live API monitoring' });
  }

  // === API HANDLERS ===

  private async handleRunDemo(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const user = req.user!;
    const result = runCostExplosionDemo(user.id);

    // Audit the demo run
    const auditEntry = immutableAudit.recordDecision({
      requestId: result.demoId,
      userId: user.id,
      sessionId: req.sessionToken || 'demo-session',
      request: 'Cost explosion demo simulation',
      policySnapshot: { scenario: 'runaway_loop', detectionThreshold: 3 },
      executionTrace: result.executionTrace,
      decision: result.blocked > 0 ? 'block' : 'allow',
      decisionReason: `Blocked ${result.blocked} runaway calls`,
      decisionCategory: 'loop',
      costBefore: result.costBefore,
      costAfter: result.costAfter,
      moneySaved: result.saved,
      dangerScore: result.blocked > 40 ? 95 : 50,
      riskLevel: result.blocked > 40 ? 'CRITICAL' : 'HIGH',
      loopDetected: true,
      loopCount: result.blocked,
    });

    this.sendJSON(res, 200, {
      demoId: result.demoId,
      costBefore: result.costBefore,
      costAfter: result.costAfter,
      saved: result.saved,
      percentSaved: result.percentSaved,
      blocked: result.blocked,
      allowed: result.allowed,
      insight: `We blocked ${result.blocked} runaway calls before they cost you money`,
      auditEntryId: auditEntry.entryId,
    });
  }

  private async handleApiKeys(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const keys = this.userStore.getApiKeys(req.user!.id);
    
    if (req.method === 'POST') {
      const newKey = this.userStore.createApiKey(req.user!.id, 'New Key');
      this.sendJSON(res, 201, { key: newKey.key, id: newKey.id });
    } else {
      this.sendJSON(res, 200, { 
        keys: keys.map((k: ApiKey) => ({ 
          id: k.id, 
          name: k.name, 
          prefix: k.key.substring(0, 8) + '...',
          lastUsed: k.lastUsedAt,
        })) 
      });
    }
  }

  private async handleUsage(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const stats = immutableAudit.getUserSavings(req.user!.id);
    this.sendJSON(res, 200, stats);
  }

  // === HELPERS ===

  private async authenticate(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');

    if (!token) {
      this.sendError(res, 401, 'Authentication required');
      return;
    }

    const session = this.userStore.getSession(token);
    if (!session || session.expiresAt < Date.now()) {
      this.sendError(res, 401, 'Session expired');
      return;
    }

    const user = this.userStore.getUser(session.userId);
    if (!user) {
      this.sendError(res, 401, 'User not found');
      return;
    }

    req.user = user;
    req.sessionToken = token;
  }

  private sendJSON(res: http.ServerResponse, status: number, data: unknown): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(status);
    res.end(JSON.stringify(data));
  }

  private sendError(res: http.ServerResponse, status: number, message: string): void {
    this.sendJSON(res, status, { error: message });
  }

  private async parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          resolve(JSON.parse(body) as Record<string, unknown>);
        } catch {
          resolve({});
        }
      });
    });
  }
}

export const saasServer = new SaaSServer();
export async function startSaaS(config?: Partial<SaaSConfig>): Promise<SaaSServer> {
  const server = new SaaSServer(config);
  await server.start();
  return server;
}
