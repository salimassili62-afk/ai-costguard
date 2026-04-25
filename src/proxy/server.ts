import express, { Request, Response } from 'express';
import axios, { AxiosRequestConfig } from 'axios';
import { Server } from 'http';
import { detectionEngine } from '../core/DetectionEngine';
import { Logger, LogEntry } from '../logger';
import { estimateTokens, estimateMessagesTokens, ChatMessageContent } from '../token-counter';
import { estimateCost, getModelPricing } from '../config';
import { ConfigManager } from '../config';
import { createHash, randomUUID } from 'crypto';
import { formatAlert } from '../utils/alert';

export class ProxyServer {
  private app: express.Application;
  private logger: Logger;
  private config: ConfigManager;
  private port: number;
  private server: Server | null = null;
  private rateLimitMap: Map<string, number[]>;

  constructor(port?: number) {
    this.app = express();
    this.logger = new Logger();
    this.config = new ConfigManager();
    this.port = port || this.config.proxyPort;
    this.rateLimitMap = new Map<string, number[]>();

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '10mb' }));
    
    // Rate limiting middleware
    this.app.use((req, res, next) => {
      const clientIp = req.ip || 'unknown';
      const now = Date.now();
      const oneMinuteAgo = now - 60000;
      
      const requests = this.rateLimitMap.get(clientIp) || [];
      const recentRequests = requests.filter(t => t > oneMinuteAgo);
      
      if (recentRequests.length >= this.config.rateLimitPerMinute) {
        res.status(429).json({ error: 'Too many requests', retryAfter: 60 });
        return;
      }
      
      recentRequests.push(now);
      this.rateLimitMap.set(clientIp, recentRequests);
      next();
    });
    
    // API key protection middleware
    this.app.use((req, res, next) => {
      const configuredApiKey = this.config.apiKey;
      const requestApiKey = req.headers['x-firewall-api-key'] as string;
      
      if (configuredApiKey && requestApiKey !== configuredApiKey) {
        res.status(401).json({ error: 'Unauthorized: Invalid firewall API key' });
        return;
      }
      
      next();
    });
    
    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Anthropic proxy endpoint (MUST be first - more specific)
    this.app.all('/v1/messages', async (req: Request, res: Response) => {
      await this.handleAnthropicRequest(req, res);
    });

    // OpenAI proxy endpoint (catches everything else under /v1/)
    this.app.all('/v1/*', async (req: Request, res: Response) => {
      await this.handleOpenAIRequest(req, res);
    });

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', stats: detectionEngine.getStats() });
    });
  }

  private async handleOpenAIRequest(req: Request, res: Response): Promise<void> {
    try {
      const model = req.body?.model || 'gpt-3.5-turbo';
      const messages = req.body?.messages || [];
      const prompt = JSON.stringify(messages);
      
      // Estimate tokens and cost
      const inputTokens = estimateMessagesTokens(messages);
      const pricing = getModelPricing(model);
      if (!pricing) {
        console.warn(`Unknown model: ${model}, allowing request`);
        await this.forwardRequest(req, res, 'https://api.openai.com');
        return;
      }

      const estimatedCost = estimateCost(model, inputTokens, 1000); // Estimate 1K output tokens

      // Check cost limit
      if (estimatedCost > this.config.maxCostPerRequest) {
        const message = `Request blocked: Estimated cost $${estimatedCost.toFixed(4)} exceeds maximum $${this.config.maxCostPerRequest.toFixed(2)}`;
        this.logRequest(model, inputTokens, 0, estimatedCost, true, 100, message, prompt, {
          category: 'spike',
          severity: 'CRITICAL',
          action: 'block',
          killSwitchTriggered: true,
        });
        res.status(403).json({ error: message, blocked: true });
        return;
      }

      // Detect danger using unified DetectionEngine
      const detectionResult = detectionEngine.analyze({
        model,
        prompt,
        estimatedCost,
        trustMode: this.config.trustMode,
        override: false
      });
      
      if (detectionResult.decision === 'block') {
        const isKillSwitch = detectionResult.dangerScore >= 90;
        const message = isKillSwitch
          ? `🔴 KILL SWITCH: ${detectionResult.reason}. 💸 Prevented: $${estimatedCost.toFixed(4)}`
          : `Blocked request: ${detectionResult.reason}. Estimated loss: $${estimatedCost.toFixed(4)}`;
        
        this.logRequest(model, inputTokens, 0, estimatedCost, true, detectionResult.dangerScore, detectionResult.reason, prompt, {
          category: detectionResult.category,
          severity: isKillSwitch ? 'CRITICAL' : 'HIGH',
          action: 'block',
          killSwitchTriggered: isKillSwitch,
        });
        
        res.status(403).json({ 
          error: message, 
          blocked: true,
          dangerScore: detectionResult.dangerScore,
          killSwitchTriggered: isKillSwitch,
          suggestions: ['Use a cheaper model', 'Reduce token count', 'Split into smaller requests']
        });
        return;
      }

      if (detectionResult.decision === 'warn') {
        const alertCategory: 'loop' | 'duplicate' | 'fuzzy_duplicate' | 'context' | 'spike' | 'anomaly' =
          detectionResult.category === 'safe' || detectionResult.category === 'invalid'
            ? 'anomaly'
            : detectionResult.category;
        const alert = formatAlert({
          severity: 'MEDIUM',
          category: alertCategory,
          reason: detectionResult.reason,
          estimatedLoss: estimatedCost,
          suggestions: ['Use a cheaper model', 'Reduce token count', 'Split into smaller requests'],
        });
        if (alert) console.log(alert);
      }

      // Forward request
      await this.forwardRequest(req, res, 'https://api.openai.com');
      
      // Log successful request
      this.logRequest(model, inputTokens, 0, estimatedCost, false, detectionResult.dangerScore, '', prompt, {
        category: detectionResult.decision === 'allow' ? 'safe' : detectionResult.category,
        severity: detectionResult.dangerScore >= 50 ? 'MEDIUM' : 'SAFE',
        action: detectionResult.decision,
        killSwitchTriggered: false,
      });

    } catch (error) {
      console.error('Error handling OpenAI request:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async handleAnthropicRequest(req: Request, res: Response): Promise<void> {
    try {
      const model = req.body?.model || 'claude-3-sonnet-20240229';
      const messages = req.body?.messages || [];
      
      const prompt = JSON.stringify(messages);
      
      // Estimate tokens and cost
      const inputTokens = estimateMessagesTokens(messages, model);
      const pricing = getModelPricing(model);
      if (!pricing) {
        console.warn(`Unknown model: ${model}, allowing request`);
        await this.forwardRequest(req, res, 'https://api.anthropic.com');
        return;
      }

      const estimatedCost = estimateCost(model, inputTokens, 1000);

      // Check cost limit
      if (estimatedCost > this.config.maxCostPerRequest) {
        const message = `Request blocked: Estimated cost $${estimatedCost.toFixed(4)} exceeds maximum $${this.config.maxCostPerRequest.toFixed(2)}`;
        this.logRequest(model, inputTokens, 0, estimatedCost, true, 100, message, prompt, {
          category: 'spike',
          severity: 'CRITICAL',
          action: 'block',
          killSwitchTriggered: true,
        });
        res.status(403).json({ error: message, blocked: true });
        return;
      }

      // Detect danger using unified DetectionEngine
      const detectionResult = detectionEngine.analyze({
        model,
        prompt,
        estimatedCost,
        trustMode: this.config.trustMode,
        override: false
      });
      
      if (detectionResult.decision === 'block') {
        const isKillSwitch = detectionResult.dangerScore >= 90;
        const message = isKillSwitch
          ? `🔴 KILL SWITCH: ${detectionResult.reason}. 💸 Prevented: $${estimatedCost.toFixed(4)}`
          : `Blocked request: ${detectionResult.reason}. Estimated loss: $${estimatedCost.toFixed(4)}`;
        
        this.logRequest(model, inputTokens, 0, estimatedCost, true, detectionResult.dangerScore, detectionResult.reason, prompt, {
          category: detectionResult.category,
          severity: isKillSwitch ? 'CRITICAL' : 'HIGH',
          action: 'block',
          killSwitchTriggered: isKillSwitch,
        });
        
        res.status(403).json({ 
          error: message, 
          blocked: true,
          dangerScore: detectionResult.dangerScore,
          killSwitchTriggered: isKillSwitch,
          suggestions: ['Use a cheaper model', 'Reduce token count', 'Split into smaller requests']
        });
        return;
      }

      if (detectionResult.decision === 'warn') {
        const alertCategory: 'loop' | 'duplicate' | 'fuzzy_duplicate' | 'context' | 'spike' | 'anomaly' =
          detectionResult.category === 'safe' || detectionResult.category === 'invalid'
            ? 'anomaly'
            : detectionResult.category;
        const alert = formatAlert({
          severity: 'MEDIUM',
          category: alertCategory,
          reason: detectionResult.reason,
          estimatedLoss: estimatedCost,
          suggestions: ['Use a cheaper model', 'Reduce token count', 'Split into smaller requests'],
        });
        if (alert) console.log(alert);
      }

      // Forward request
      await this.forwardRequest(req, res, 'https://api.anthropic.com');
      
      // Log successful request
      this.logRequest(model, inputTokens, 0, estimatedCost, false, detectionResult.dangerScore, '', prompt, {
        category: detectionResult.decision === 'allow' ? 'safe' : detectionResult.category,
        severity: detectionResult.dangerScore >= 50 ? 'MEDIUM' : 'SAFE',
        action: detectionResult.decision,
        killSwitchTriggered: false,
      });

    } catch (error) {
      console.error('Error handling Anthropic request:', error);
      res.status(500).json({ error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async forwardRequest(req: Request, res: Response, baseUrl: string): Promise<void> {
    // Forward all headers except hop-by-hop headers
    const hopByHopHeaders = [
      'host',
      'connection',
      'keep-alive',
      'transfer-encoding',
      'te',
      'trailer',
      'upgrade',
      'proxy-authorization',
      'proxy-authenticate',
    ];
    
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value && !hopByHopHeaders.includes(key.toLowerCase())) {
        headers[key] = Array.isArray(value) ? value[0] : value;
      }
    }
    
    // Preserve query parameters
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const url = `${baseUrl}${req.path}${queryString ? '?' + queryString : ''}`;
    
    // Check if streaming is requested
    const isStreaming = req.body?.stream === true || req.query?.stream === 'true';
    
    const axiosConfig: AxiosRequestConfig = {
      method: req.method,
      url,
      headers: {
        ...headers,
        host: new URL(baseUrl).host,
      },
      data: req.body,
      timeout: 120000,
      responseType: isStreaming ? 'stream' : 'json',
    };

    // Retry logic with exponential backoff
    const maxRetries = 3;
    let lastError: any = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios(axiosConfig);
        
        res.status(response.status);
        
        // Forward headers (except hop-by-hop)
        for (const [key, value] of Object.entries(response.headers)) {
          if (!hopByHopHeaders.includes(key.toLowerCase())) {
            res.setHeader(key, value);
          }
        }
        
        if (isStreaming && response.data) {
          response.data.pipe(res);
          return;
        } else {
          res.json(response.data);
          return;
        }
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on client errors (4xx)
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
          // Forward the actual error response
          if (error.response.data) {
            res.status(error.response.status);
            res.json(error.response.data);
          } else {
            res.status(error.response.status).json({ error: error.message });
          }
          return;
        }
        
        if (attempt === maxRetries) {
          // Forward the actual error on final attempt
          if (error.response) {
            res.status(error.response.status).json(error.response.data || { error: error.message });
          } else {
            res.status(502).json({ error: 'Bad Gateway', message: error.message });
          }
          return;
        }
        
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  private logRequest(
    model: string,
    inputTokens: number,
    outputTokens: number,
    estimatedCost: number,
    wasBlocked: boolean,
    dangerScore: number,
    reason: string,
    prompt: string,
    decisionTrace?: any
  ): void {
    const promptHash = createHash('sha256').update(prompt).digest('hex');
    const traceId = randomUUID();

    const entry: LogEntry = {
      timestamp: Date.now(),
      traceId,
      model,
      inputTokens,
      outputTokens,
      estimatedCost,
      wasBlocked,
      dangerScore,
      reason,
      promptHash,
      decisionTrace,
    };

    this.logger.log(entry);

    if (wasBlocked) {
      console.log(`🔴 BLOCKED by Firewall: ${reason} (danger score: ${dangerScore}) [trace: ${traceId}]`);
    }
  }

  start(): void {
    this.server = this.app.listen(this.port, () => {
      console.log(`\n🛡️  AI EXECUTION FIREWALL running on port ${this.port}`);
      console.log(`🚨 Danger Blocking: ${this.config.trustMode === 'block' ? 'ACTIVE' : this.config.trustMode === 'warn' ? 'WARN' : 'MONITOR'}`);
      console.log(`💰 Max cost per request: $${this.config.maxCostPerRequest.toFixed(2)}`);
      console.log(`⚠️  Danger threshold: ${this.config.dangerThreshold}%`);
      console.log(`\nConfigure your AI SDK to use: http://localhost:${this.port}\n`);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  stop(): void {
    if (this.server) {
      this.server.close(() => {
        console.log('\n🛡️  AI Execution Firewall stopped gracefully');
      });
    }
  }
}
