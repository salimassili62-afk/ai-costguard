/**
 * SaaSServer.ts - Production SaaS Backend Service
 * 
 * Real hosted product with:
 * - User accounts & authentication
 * - API key management
 * - Public REST API
 * - Dashboard serving
 * - Onboarding flow
 * 
 * URL Structure:
 * - GET  /          → Landing page (signup)
 * - POST /auth/signup → Create account (email or anonymous)
 * - GET  /dashboard → User dashboard (auto-redirect after signup)
 * - GET  /api/keys  → List API keys
 * - POST /api/keys  → Generate new API key
 * - POST /api/demo/run → Run instant demo (returns ROI)
 * - GET  /api/demo/result/:id → Get demo results
 */

import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import { UserStore, User, ApiKey, Session } from './UserStore';
import { runHeroDemo, DemoResult } from './HeroDemo';

export interface SaaSConfig {
  port: number;
  host: string;
  baseUrl: string;
  jwtSecret: string;
  sessionDurationHours: number;
}

interface AuthenticatedRequest extends http.IncomingMessage {
  user?: User;
  apiKey?: ApiKey;
}

/**
 * SaaSServer - Production-hosted service
 * 
 * User journey:
 * 1. Landing page → Signup (email or anonymous)
 * 2. Auto-redirect to dashboard with API key
 * 3. One-click "Run Demo" → instant ROI shown
 * 4. Copy API key → start using in production
 */
export class SaaSServer {
  private server: http.Server | null = null;
  private config: SaaSConfig;
  private userStore: UserStore;

  constructor(config?: Partial<SaaSConfig>) {
    this.config = {
      port: 3000,
      host: '0.0.0.0',
      baseUrl: process.env.BASE_URL || 'https://ai-costguard.com',
      jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
      sessionDurationHours: 24 * 7, // 1 week
      ...config,
    };
    this.userStore = new UserStore();
  }

  /**
   * Start the SaaS server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req as AuthenticatedRequest, res).catch(err => {
          console.error('Request error:', err);
          this.sendJSON(res, 500, { error: 'Internal server error' });
        });
      });

      this.server.listen(this.config.port, this.config.host, () => {
        console.log(`🚀 SaaS Server running at ${this.config.baseUrl}`);
        console.log(`   Landing: ${this.config.baseUrl}/`);
        console.log(`   API: ${this.config.baseUrl}/api/`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // Request routing
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

    // Public routes (no auth)
    if (pathname === '/' || pathname === '/landing') {
      await this.serveLandingPage(req, res);
      return;
    }

    if (pathname === '/auth/signup' && req.method === 'POST') {
      await this.handleSignup(req, res);
      return;
    }

    if (pathname === '/auth/login' && req.method === 'POST') {
      await this.handleLogin(req, res);
      return;
    }

    // Authenticate all other routes
    await this.authenticate(req, res);
    if (!req.user) return; // Auth failed

    // Authenticated routes
    if (pathname === '/dashboard') {
      await this.serveDashboard(req, res);
      return;
    }

    if (pathname === '/api/keys' && req.method === 'GET') {
      await this.listApiKeys(req, res);
      return;
    }

    if (pathname === '/api/keys' && req.method === 'POST') {
      await this.createApiKey(req, res);
      return;
    }

    if (pathname === '/api/demo/run' && req.method === 'POST') {
      await this.runInstantDemo(req, res);
      return;
    }

    if (pathname.startsWith('/api/demo/result/') && req.method === 'GET') {
      const demoId = pathname.split('/')[4];
      await this.getDemoResult(req, res, demoId);
      return;
    }

    if (pathname === '/api/user' && req.method === 'GET') {
      await this.getCurrentUser(req, res);
      return;
    }

    // 404
    this.sendJSON(res, 404, { error: 'Not found' });
  }

  // Auth handlers
  private async handleSignup(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.parseBody(req);
    const email = body.email as string | undefined;
    const anonymous = body.anonymous as boolean | undefined;

    let user: User;

    if (anonymous || !email) {
      // Anonymous session - no email required
      user = this.userStore.createAnonymousUser();
    } else {
      // Email signup
      const existing = this.userStore.findByEmail(email);
      if (existing) {
        this.sendJSON(res, 409, { error: 'Email already registered' });
        return;
      }
      user = this.userStore.createUser(email);
    }

    // Auto-generate first API key
    const apiKey = this.userStore.createApiKey(user.id, 'default');

    // Create session
    const session = this.userStore.createSession(user.id);

    this.sendJSON(res, 201, {
      user: this.sanitizeUser(user),
      apiKey: apiKey.key,
      sessionToken: session.token,
      redirectTo: '/dashboard',
    });
  }

  private async handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.parseBody(req);
    const email = body.email as string | undefined;

    const user = email ? this.userStore.findByEmail(email) : undefined;
    if (!user) {
      this.sendJSON(res, 401, { error: 'Invalid credentials' });
      return;
    }

    const session = this.userStore.createSession(user.id);

    this.sendJSON(res, 200, {
      user: this.sanitizeUser(user),
      sessionToken: session.token,
      redirectTo: '/dashboard',
    });
  }

  // API handlers
  private async listApiKeys(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const keys = this.userStore.getApiKeys(req.user!.id);
    this.sendJSON(res, 200, { 
      keys: keys.map((k: ApiKey) => ({
        id: k.id,
        name: k.name,
        prefix: k.key.substring(0, 8) + '...',
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      }))
    });
  }

  private async createApiKey(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const body = await this.parseBody(req);
    const name = (body.name as string) || 'New API Key';
    
    const apiKey = this.userStore.createApiKey(req.user!.id, name);
    
    this.sendJSON(res, 201, {
      key: apiKey.key, // Only shown once
      id: apiKey.id,
      name: apiKey.name,
    });
  }

  private async runInstantDemo(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    // Run the hero demo scenario
    const result = runHeroDemo(req.user!.id);
    
    this.sendJSON(res, 200, {
      demoId: result.demoId,
      summary: result.summary,
      instantResult: {
        costBefore: result.summary.totalCostBefore,
        costAfter: result.summary.totalCostAfter,
        saved: result.summary.totalSaved,
        percentReduction: result.summary.savingsPercent,
        blockedRequests: result.summary.blocked,
      },
      viewUrl: `/api/demo/result/${result.demoId}`,
    });
  }

  private async getDemoResult(req: AuthenticatedRequest, res: http.ServerResponse, demoId: string): Promise<void> {
    const result = runHeroDemo(req.user!.id); // In real implementation, fetch from storage
    
    this.sendJSON(res, 200, {
      demoId,
      userId: req.user!.id,
      result: result.summary,
      timeline: result.timeline.slice(0, 10),
    });
  }

  private async getCurrentUser(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    this.sendJSON(res, 200, {
      user: this.sanitizeUser(req.user!),
      apiKeys: this.userStore.getApiKeys(req.user!.id).length,
    });
  }

  // Page serving
  private async serveLandingPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const html = this.generateLandingPage();
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
  }

  private async serveDashboard(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const user = req.user!;
    const apiKeys = this.userStore.getApiKeys(user.id);
    const defaultKey = apiKeys[0];

    const html = this.generateDashboard(user, defaultKey);
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
  }

  // Auth middleware
  private async authenticate(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      this.sendJSON(res, 401, { error: 'Authentication required' });
      return;
    }

    // Check session token
    const session = this.userStore.getSession(token);
    if (session && session.expiresAt > Date.now()) {
      const user = this.userStore.getUser(session.userId);
      if (user) {
        req.user = user;
        return;
      }
    }

    // Check API key
    const apiKey = this.userStore.findApiKey(token);
    if (apiKey) {
      const user = this.userStore.getUser(apiKey.userId);
      if (user) {
        req.user = user;
        req.apiKey = apiKey;
        this.userStore.updateApiKeyLastUsed(apiKey.id);
        return;
      }
    }

    this.sendJSON(res, 401, { error: 'Invalid credentials' });
  }

  // Helpers
  private sendJSON(res: http.ServerResponse, status: number, data: unknown): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(status);
    res.end(JSON.stringify(data, null, 2));
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

  private sanitizeUser(user: User): Record<string, unknown> {
    return {
      id: user.id,
      email: user.email,
      anonymous: user.anonymous,
      createdAt: user.createdAt,
    };
  }

  // HTML generators
  private generateLandingPage(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Cost Guard - Stop Agent Cost Explosions</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: white;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 60px 20px;
      text-align: center;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 16px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    .subtitle {
      font-size: 1.25rem;
      opacity: 0.9;
      margin-bottom: 40px;
      line-height: 1.5;
    }
    .hero-metric {
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin: 32px 0;
    }
    .hero-metric-value {
      font-size: 3rem;
      font-weight: bold;
      color: #4ade80;
    }
    .hero-metric-label {
      font-size: 1rem;
      opacity: 0.9;
      margin-top: 8px;
    }
    .cta-form {
      background: white;
      border-radius: 16px;
      padding: 32px;
      margin-top: 40px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .cta-form h2 {
      color: #333;
      margin-bottom: 8px;
    }
    .cta-form p {
      color: #666;
      margin-bottom: 24px;
    }
    input[type="email"] {
      width: 100%;
      padding: 16px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 1rem;
      margin-bottom: 16px;
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
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
    }
    .anonymous-btn {
      background: transparent;
      color: #667eea;
      border: 2px solid #667eea;
      margin-top: 12px;
    }
    .anonymous-btn:hover {
      background: #667eea;
      color: white;
    }
    .features {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
      margin-top: 48px;
      text-align: center;
    }
    .feature {
      opacity: 0.9;
    }
    .feature-icon {
      font-size: 2rem;
      margin-bottom: 8px;
    }
    .loading {
      display: none;
      color: #667eea;
      margin-top: 16px;
    }
    .error {
      color: #dc3545;
      margin-top: 8px;
      font-size: 0.9rem;
    }
    @media (max-width: 480px) {
      h1 { font-size: 2rem; }
      .features { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🛡️ Stop AI Agent Cost Explosions</h1>
    <p class="subtitle">
      Runaway AI agents can burn through $10,000 in hours.<br>
      We block cost explosions before they happen.
    </p>
    
    <div class="hero-metric">
      <div class="hero-metric-value">87%</div>
      <div class="hero-metric-label">Average cost reduction in production</div>
    </div>

    <div class="cta-form">
      <h2>Start Free - No Credit Card</h2>
      <p>Get instant API key + run demo in 60 seconds</p>
      
      <form id="signupForm">
        <input type="email" id="email" placeholder="Enter your email" required>
        <button type="submit" id="submitBtn">Get API Key & Run Demo</button>
        <button type="button" class="anonymous-btn" id="anonymousBtn">
          Try Anonymously (No Email)
        </button>
      </form>
      
      <div class="loading" id="loading">Creating your account...</div>
      <div class="error" id="error"></div>
    </div>

    <div class="features">
      <div class="feature">
        <div class="feature-icon">⚡</div>
        <div>Instant Setup</div>
      </div>
      <div class="feature">
        <div class="feature-icon">🔒</div>
        <div>Production Safe</div>
      </div>
      <div class="feature">
        <div class="feature-icon">📊</div>
        <div>Real-time ROI</div>
      </div>
    </div>
  </div>

  <script>
    const form = document.getElementById('signupForm');
    const emailInput = document.getElementById('email');
    const submitBtn = document.getElementById('submitBtn');
    const anonymousBtn = document.getElementById('anonymousBtn');
    const loading = document.getElementById('loading');
    const errorDiv = document.getElementById('error');

    async function signup(anonymous = false) {
      errorDiv.textContent = '';
      loading.style.display = 'block';
      submitBtn.disabled = true;
      anonymousBtn.disabled = true;

      try {
        const body = anonymous ? { anonymous: true } : { email: emailInput.value };
        
        const res = await fetch('/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Signup failed');
        }

        // Store session
        localStorage.setItem('sessionToken', data.sessionToken);
        localStorage.setItem('apiKey', data.apiKey);

        // Redirect to dashboard
        window.location.href = data.redirectTo;
      } catch (err) {
        errorDiv.textContent = err.message;
        loading.style.display = 'none';
        submitBtn.disabled = false;
        anonymousBtn.disabled = false;
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      signup(false);
    });

    anonymousBtn.addEventListener('click', () => signup(true));
  </script>
</body>
</html>`;
  }

  private generateDashboard(user: User, apiKey?: ApiKey): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - AI Cost Guard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f7fa;
      min-height: 100vh;
      color: #333;
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
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
    }
    .welcome {
      margin-bottom: 32px;
    }
    .welcome h2 {
      font-size: 1.75rem;
      margin-bottom: 8px;
    }
    .welcome p {
      color: #666;
    }
    .api-key-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 24px;
      border-radius: 12px;
      margin-bottom: 32px;
    }
    .api-key-box h3 {
      margin-bottom: 12px;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.9;
    }
    .api-key-value {
      font-family: monospace;
      font-size: 1.1rem;
      background: rgba(255,255,255,0.15);
      padding: 12px 16px;
      border-radius: 8px;
      word-break: break-all;
      margin-bottom: 12px;
    }
    .copy-btn {
      background: white;
      color: #667eea;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
    }
    .demo-card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      text-align: center;
    }
    .demo-card h3 {
      font-size: 1.5rem;
      margin-bottom: 16px;
    }
    .demo-card p {
      color: #666;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .run-demo-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 16px 48px;
      border-radius: 8px;
      font-size: 1.1rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .run-demo-btn:hover {
      transform: scale(1.05);
    }
    .run-demo-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .results {
      display: none;
      margin-top: 32px;
      padding-top: 32px;
      border-top: 2px solid #e5e7eb;
    }
    .results.show {
      display: block;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-box {
      background: #f9fafb;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
    }
    .stat-value {
      font-size: 1.75rem;
      font-weight: bold;
      color: #667eea;
      margin-bottom: 4px;
    }
    .stat-value.saved {
      color: #10b981;
    }
    .stat-label {
      font-size: 0.875rem;
      color: #666;
    }
    .next-steps {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 12px;
      padding: 24px;
      text-align: left;
    }
    .next-steps h4 {
      color: #166534;
      margin-bottom: 12px;
    }
    .next-steps ol {
      margin-left: 20px;
      color: #166534;
    }
    .next-steps li {
      margin-bottom: 8px;
    }
    .code-block {
      background: #1f2937;
      color: #e5e7eb;
      padding: 16px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.9rem;
      margin: 12px 0;
      overflow-x: auto;
    }
    .loading {
      display: none;
      color: #667eea;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🛡️ AI Cost Guard</h1>
    <span>${user.email || 'Anonymous User'}</span>
  </div>

  <div class="container">
    <div class="welcome">
      <h2>Welcome! You're all set.</h2>
      <p>Your API key is ready. Run the demo to see how much you could save.</p>
    </div>

    <div class="api-key-box">
      <h3>Your API Key</h3>
      <div class="api-key-value" id="apiKey">${apiKey?.key || 'Generating...'}</div>
      <button class="copy-btn" onclick="copyApiKey()">Copy</button>
    </div>

    <div class="demo-card">
      <h3>See It In Action</h3>
      <p>
        Run a simulation of a runaway AI agent making redundant API calls.<br>
        See how much the firewall saves you in real-time.
      </p>
      <button class="run-demo-btn" id="runDemoBtn" onclick="runDemo()">
        Run Demo (Takes 5 Seconds)
      </button>
      <div class="loading" id="loading">Running simulation...</div>

      <div class="results" id="results">
        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-value" id="costBefore">$0.00</div>
            <div class="stat-label">Cost Without Protection</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" id="costAfter">$0.00</div>
            <div class="stat-label">Cost With Firewall</div>
          </div>
          <div class="stat-box">
            <div class="stat-value saved" id="saved">$0.00</div>
            <div class="stat-label">Money Saved</div>
          </div>
        </div>

        <div class="next-steps">
          <h4>🎉 You're ready to protect your production API calls</h4>
          <ol>
            <li>Copy your API key above</li>
            <li>Install the SDK: <code>npm install ai-costguard</code></li>
            <li>Wrap your OpenAI calls:</li>
          </ol>
          <div class="code-block">import { withFirewall } from 'ai-costguard';

const protectedOpenAI = withFirewall(openai, {
  apiKey: '${apiKey?.key || 'YOUR_API_KEY'}'
});</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function copyApiKey() {
      const key = document.getElementById('apiKey').textContent;
      navigator.clipboard.writeText(key);
      alert('API key copied!');
    }

    async function runDemo() {
      const btn = document.getElementById('runDemoBtn');
      const loading = document.getElementById('loading');
      const results = document.getElementById('results');

      btn.disabled = true;
      loading.style.display = 'block';

      try {
        const sessionToken = localStorage.getItem('sessionToken');
        
        const res = await fetch('/api/demo/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + sessionToken,
          },
        });

        const data = await res.json();

        if (!res.ok) throw new Error(data.error);

        // Show results
        document.getElementById('costBefore').textContent = 
          '$' + data.instantResult.costBefore.toFixed(2);
        document.getElementById('costAfter').textContent = 
          '$' + data.instantResult.costAfter.toFixed(2);
        document.getElementById('saved').textContent = 
          '$' + data.instantResult.saved.toFixed(2);

        loading.style.display = 'none';
        results.classList.add('show');
      } catch (err) {
        alert('Demo failed: ' + err.message);
        btn.disabled = false;
        loading.style.display = 'none';
      }
    }
  </script>
</body>
</html>`;
  }
}

// Convenience exports
export const saasServer = new SaaSServer();
export function startSaaS(config?: Partial<SaaSConfig>): Promise<SaaSServer> {
  const server = new SaaSServer(config);
  return server.start().then(() => server);
}
