import express, { Request, Response } from 'express';
import axios, { AxiosRequestConfig } from 'axios';
import { WasteDetector } from '../waste-detection';
import { Logger, LogEntry } from '../logger';
import { estimateTokens, estimateMessagesTokens } from '../token-counter';
import { estimateCost, getModelPricing } from '../config';
import { ConfigManager } from '../config';

export class ProxyServer {
  private app: express.Application;
  private wasteDetector: WasteDetector;
  private logger: Logger;
  private config: ConfigManager;
  private port: number;

  constructor(port?: number) {
    this.app = express();
    this.wasteDetector = new WasteDetector();
    this.logger = new Logger();
    this.config = new ConfigManager();
    this.port = port || this.config.proxyPort;

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // OpenAI proxy endpoint
    this.app.all('/v1/*', async (req: Request, res: Response) => {
      await this.handleOpenAIRequest(req, res);
    });

    // Anthropic proxy endpoint
    this.app.all('/v1/messages', async (req: Request, res: Response) => {
      await this.handleAnthropicRequest(req, res);
    });

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', wasteDetectorStats: this.wasteDetector.getStats() });
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
        this.logRequest(model, inputTokens, 0, estimatedCost, true, 100, message, prompt);
        res.status(403).json({ error: message, blocked: true });
        return;
      }

      // Detect waste
      const wasteResult = this.wasteDetector.detectWaste(model, prompt, estimatedCost);
      
      if (wasteResult.isWasteful && wasteResult.wasteScore >= this.config.wasteThreshold) {
        if (this.config.blockMode) {
          const message = `Blocked request: ${wasteResult.reason}. Estimated waste: $${wasteResult.estimatedWaste.toFixed(4)}`;
          this.logRequest(model, inputTokens, 0, estimatedCost, true, wasteResult.wasteScore, wasteResult.reason, prompt);
          res.status(403).json({ 
            error: message, 
            blocked: true,
            wasteScore: wasteResult.wasteScore,
            suggestions: wasteResult.suggestions
          });
          return;
        } else {
          console.warn(`Warning: ${wasteResult.reason}`);
        }
      }

      // Forward request
      await this.forwardRequest(req, res, 'https://api.openai.com');
      
      // Log successful request
      this.logRequest(model, inputTokens, 0, estimatedCost, false, wasteResult.wasteScore, '', prompt);

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
      const inputTokens = estimateMessagesTokens(messages);
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
        this.logRequest(model, inputTokens, 0, estimatedCost, true, 100, message, prompt);
        res.status(403).json({ error: message, blocked: true });
        return;
      }

      // Detect waste
      const wasteResult = this.wasteDetector.detectWaste(model, prompt, estimatedCost);
      
      if (wasteResult.isWasteful && wasteResult.wasteScore >= this.config.wasteThreshold) {
        if (this.config.blockMode) {
          const message = `Blocked request: ${wasteResult.reason}. Estimated waste: $${wasteResult.estimatedWaste.toFixed(4)}`;
          this.logRequest(model, inputTokens, 0, estimatedCost, true, wasteResult.wasteScore, wasteResult.reason, prompt);
          res.status(403).json({ 
            error: message, 
            blocked: true,
            wasteScore: wasteResult.wasteScore,
            suggestions: wasteResult.suggestions
          });
          return;
        } else {
          console.warn(`Warning: ${wasteResult.reason}`);
        }
      }

      // Forward request
      await this.forwardRequest(req, res, 'https://api.anthropic.com');
      
      // Log successful request
      this.logRequest(model, inputTokens, 0, estimatedCost, false, wasteResult.wasteScore, '', prompt);

    } catch (error) {
      console.error('Error handling Anthropic request:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async forwardRequest(req: Request, res: Response, baseUrl: string): Promise<void> {
    const axiosConfig: AxiosRequestConfig = {
      method: req.method,
      url: `${baseUrl}${req.path}`,
      headers: {
        ...req.headers,
        host: new URL(baseUrl).host,
      },
      data: req.body,
    };

    const response = await axios(axiosConfig);
    res.status(response.status).json(response.data);
  }

  private logRequest(
    model: string,
    inputTokens: number,
    outputTokens: number,
    estimatedCost: number,
    wasBlocked: boolean,
    wasteScore: number,
    reason: string,
    prompt: string
  ): void {
    const { createHash } = require('crypto');
    const promptHash = createHash('sha256').update(prompt).digest('hex');

    const entry: LogEntry = {
      timestamp: Date.now(),
      model,
      inputTokens,
      outputTokens,
      estimatedCost,
      wasBlocked,
      wasteScore,
      reason,
      promptHash,
    };

    this.logger.log(entry);

    if (wasBlocked) {
      console.log(`🚫 Blocked: ${reason} (waste score: ${wasteScore})`);
    }
  }

  start(): void {
    this.app.listen(this.port, () => {
      console.log(`\n🛡️  AI Waste Guard Proxy running on port ${this.port}`);
      console.log(`📊 Block mode: ${this.config.blockMode ? 'ON' : 'OFF'}`);
      console.log(`💰 Max cost per request: $${this.config.maxCostPerRequest.toFixed(2)}`);
      console.log(`⚠️  Waste threshold: ${this.config.wasteThreshold}%`);
      console.log(`\nConfigure your AI SDK to use: http://localhost:${this.port}\n`);
    });
  }
}
