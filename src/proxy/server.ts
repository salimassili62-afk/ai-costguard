import express, { Request, Response } from 'express';
import axios, { AxiosRequestConfig } from 'axios';
import { Server } from 'http';
import { detectionEngine } from '../core/DetectionEngine';
import { Logger, LogEntry, logger } from '../logger';
import { estimateTokens, estimateMessagesTokens, ChatMessageContent } from '../token-counter';
import { estimateCost, getModelPricing } from '../config';
import { ConfigManager } from '../config';
import { createHash, randomUUID } from 'crypto';
import { formatAlert } from '../utils/alert';

export class ProxyServer {
  private app: express.Application;
  private dbLogger: Logger;
  private config: ConfigManager;
  private port: number;
  private server: Server | null = null;
  private rateLimitMap: Map<string, number[]>;
  public readonly maxRetries = 3;

  constructor(port?: number) {
    this.app = express();
    this.dbLogger = new Logger();
    this.config = new ConfigManager();
    this.port = port || this.config.proxyPort;
    this.rateLimitMap = new Map<string, number[]>();

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Body parsing - needed for all routes
    this.app.use(express.json({ limit: '10mb' }));

    // Health check - bypasses all other middleware
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', stats: detectionEngine.getStats(1) });
    });

    this.app.get('/metrics', (req: Request, res: Response) => {
      const stats = detectionEngine.getStats(24);
      res
        .type('text/plain')
        .send(
          [
            '# HELP aifw_requests_total Total requests analyzed by AI Execution Firewall',
            '# TYPE aifw_requests_total counter',
            `aifw_requests_total ${stats.totalRequests}`,
            '# HELP aifw_blocked_requests_total Total blocked requests',
            '# TYPE aifw_blocked_requests_total counter',
            `aifw_blocked_requests_total ${stats.blockedRequests}`,
            '# HELP aifw_warned_requests_total Total warned requests',
            '# TYPE aifw_warned_requests_total counter',
            `aifw_warned_requests_total ${stats.warnedRequests}`,
            '# HELP aifw_prevented_cost_usd Estimated prevented cost in USD',
            '# TYPE aifw_prevented_cost_usd counter',
            `aifw_prevented_cost_usd ${stats.preventedCost}`,
            '# HELP aifw_actual_cost_usd Estimated allowed cost in USD',
            '# TYPE aifw_actual_cost_usd counter',
            `aifw_actual_cost_usd ${stats.actualCost}`,
            '',
          ].join('\n')
        );
    });

    // Rate limiting middleware (excludes health)
    this.app.use((req, res, next) => {
      const forwardedFor = req.headers['x-forwarded-for'];
      const clientIp =
        (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim() || req.ip || 'unknown';
      const now = Date.now();
      const oneMinuteAgo = now - 60000;

      const requests = this.rateLimitMap.get(clientIp) || [];
      const recentRequests = requests.filter((t) => t > oneMinuteAgo);

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
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Anthropic proxy endpoint - explicit POST
    this.app.post('/v1/messages', async (req: Request, res: Response) => {
      await this.handleAnthropicRequest(req, res);
    });

    // Google Gemini endpoint
    this.app.all('/v1beta/*', async (req: Request, res: Response) => {
      await this.handleGoogleRequest(req, res);
    });

    // OpenAI proxy endpoint - explicit POST for chat completions
    this.app.post('/v1/chat/completions', async (req: Request, res: Response) => {
      await this.handleOpenAIRequest(req, res);
    });

    // Fallback for other /v1/* routes
    this.app.all('/v1/*', async (req: Request, res: Response) => {
      await this.handleOpenAIRequest(req, res);
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
        logger.warn(`Unknown model: ${model}, allowing request`);
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
        override: false,
        metadata: this.extractMetadata(req, 'openai', 'proxy'),
        tokens: {
          inputTokens,
          outputTokens: 1000,
          totalTokens: inputTokens + 1000,
        },
      });
      if (detectionResult.metadata.requestId) {
        res.setHeader('x-aifw-request-id', detectionResult.metadata.requestId);
      }

      if (detectionResult.decision === 'block') {
        const isKillSwitch = detectionResult.dangerScore >= 90;
        const message = isKillSwitch
          ? `🔴 KILL SWITCH: ${detectionResult.reason}. 💸 Prevented: $${estimatedCost.toFixed(4)}`
          : `Blocked request: ${detectionResult.reason}. Estimated loss: $${estimatedCost.toFixed(4)}`;

        this.logRequest(
          model,
          inputTokens,
          0,
          estimatedCost,
          true,
          detectionResult.dangerScore,
          detectionResult.reason,
          prompt,
          {
            category: detectionResult.category,
            severity: isKillSwitch ? 'CRITICAL' : 'HIGH',
            action: 'block',
            killSwitchTriggered: isKillSwitch,
          }
        );

        res.status(403).json({
          error: message,
          blocked: true,
          dangerScore: detectionResult.dangerScore,
          killSwitchTriggered: isKillSwitch,
          suggestions: ['Use a cheaper model', 'Reduce token count', 'Split into smaller requests'],
        });
        return;
      }

      if (detectionResult.decision === 'warn') {
        const alertCategory: 'loop' | 'duplicate' | 'fuzzy_duplicate' | 'context' | 'spike' | 'budget' | 'anomaly' =
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
        if (alert) logger.info(alert);
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
      logger.error('Error handling OpenAI request:', error);
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
        logger.warn(`Unknown model: ${model}, allowing request`);
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
        override: false,
        metadata: this.extractMetadata(req, 'anthropic', 'proxy'),
        tokens: {
          inputTokens,
          outputTokens: 1000,
          totalTokens: inputTokens + 1000,
        },
      });
      if (detectionResult.metadata.requestId) {
        res.setHeader('x-aifw-request-id', detectionResult.metadata.requestId);
      }

      if (detectionResult.decision === 'block') {
        const isKillSwitch = detectionResult.dangerScore >= 90;
        const message = isKillSwitch
          ? `🔴 KILL SWITCH: ${detectionResult.reason}. 💸 Prevented: $${estimatedCost.toFixed(4)}`
          : `Blocked request: ${detectionResult.reason}. Estimated loss: $${estimatedCost.toFixed(4)}`;

        this.logRequest(
          model,
          inputTokens,
          0,
          estimatedCost,
          true,
          detectionResult.dangerScore,
          detectionResult.reason,
          prompt,
          {
            category: detectionResult.category,
            severity: isKillSwitch ? 'CRITICAL' : 'HIGH',
            action: 'block',
            killSwitchTriggered: isKillSwitch,
          }
        );

        res.status(403).json({
          error: message,
          blocked: true,
          dangerScore: detectionResult.dangerScore,
          killSwitchTriggered: isKillSwitch,
          suggestions: ['Use a cheaper model', 'Reduce token count', 'Split into smaller requests'],
        });
        return;
      }

      if (detectionResult.decision === 'warn') {
        const alertCategory: 'loop' | 'duplicate' | 'fuzzy_duplicate' | 'context' | 'spike' | 'budget' | 'anomaly' =
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
        if (alert) logger.info(alert);
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
      logger.error('Error handling Anthropic request:', error);
      res
        .status(500)
        .json({ error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private async forwardRequest(req: Request, res: Response, baseUrl: string): Promise<void> {
    // Forward all headers except hop-by-hop headers and Content-Type (let res.json() set it)
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
      'content-type',
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

    if (process.env.NODE_ENV === 'test' && process.env.AIFW_TEST_LIVE_PROXY !== 'true') {
      if (req.path.includes('invalid-endpoint')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      res.status(200).json({
        id: 'aifw-test-response',
        object: 'mock.provider.response',
        providerBaseUrl: baseUrl,
        receivedHeaders: req.headers,
        receivedBody: req.body,
      });
      return;
    }

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
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async handleGoogleRequest(req: Request, res: Response): Promise<void> {
    try {
      const model = this.extractGoogleModel(req);
      const prompt = JSON.stringify(req.body || {});
      const inputTokens = estimateTokens(prompt, model);
      const estimatedCost = estimateCost(model, inputTokens, 1000);
      const detectionResult = detectionEngine.analyze({
        model,
        prompt,
        estimatedCost,
        trustMode: this.config.trustMode,
        override: false,
        metadata: this.extractMetadata(req, 'google', 'proxy'),
        tokens: {
          inputTokens,
          outputTokens: 1000,
          totalTokens: inputTokens + 1000,
        },
      });

      if (detectionResult.metadata.requestId) {
        res.setHeader('x-aifw-request-id', detectionResult.metadata.requestId);
      }

      if (detectionResult.decision === 'block') {
        res.status(403).json({
          error: `Blocked request: ${detectionResult.reason}`,
          blocked: true,
          dangerScore: detectionResult.dangerScore,
          category: detectionResult.category,
        });
        return;
      }

      await this.forwardRequest(req, res, 'https://generativelanguage.googleapis.com');
    } catch (error) {
      logger.error('Error handling Google request:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private extractGoogleModel(req: Request): string {
    const match = req.path.match(/models\/([^:/]+)/);
    return req.body?.model || match?.[1] || 'gemini-pro';
  }

  private extractMetadata(req: Request, provider: string, integration: string) {
    return {
      requestId: req.headers['x-request-id'] as string | undefined,
      orgId: req.headers['x-tenant-id'] as string | undefined,
      teamId: req.headers['x-team-id'] as string | undefined,
      appId: req.headers['x-app-id'] as string | undefined,
      userId: req.headers['x-user-id'] as string | undefined,
      sessionId: req.headers['x-session-id'] as string | undefined,
      agentId: req.headers['x-agent-id'] as string | undefined,
      workflowId: req.headers['x-workflow-id'] as string | undefined,
      apiKeyId: req.headers['x-api-key-id'] as string | undefined,
      provider,
      integration,
    };
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

    this.dbLogger.log(entry);

    if (wasBlocked) {
      logger.info(`🔴 BLOCKED by Firewall: ${reason} (danger score: ${dangerScore}) [trace: ${traceId}]`);
    }
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`\n🛡️  AI EXECUTION FIREWALL running on port ${this.port}`);
        logger.info(
          `🚨 Danger Blocking: ${this.config.trustMode === 'block' ? 'ACTIVE' : this.config.trustMode === 'warn' ? 'WARN' : 'MONITOR'}`
        );
        logger.info(`💰 Max cost per request: $${this.config.maxCostPerRequest.toFixed(2)}`);
        logger.info(`⚠️  Danger threshold: ${this.config.dangerThreshold}%`);
        logger.info(`\nConfigure your AI SDK to use: http://localhost:${this.port}\n`);
        resolve();
      });

      // Handle graceful shutdown
      process.on('SIGTERM', () => this.stop());
      process.on('SIGINT', () => this.stop());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Clear rate limit map for testing
  clearRateLimits(): void {
    this.rateLimitMap.clear();
  }

  /**
   * Check if the server is currently listening
   */
  isListening(): boolean {
    return this.server !== null && this.server.listening;
  }
}
