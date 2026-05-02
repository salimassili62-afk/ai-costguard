/**
 * SDKInterception.ts - Source-Level SDK Override
 * 
 * Replaces direct OpenAI / Anthropic SDK calls at the source level.
 * Creates irreversible dependency: agents CANNOT execute safely without this.
 * 
 * Strategy:
 * 1. Provide drop-in replacement for OpenAI client
 * 2. Intercept ALL method calls at prototype level
 * 3. Route through ExecutionOS for safety
 * 4. Maintain API compatibility (zero friction)
 * 
 * Usage transformation:
 *   BEFORE: const openai = new OpenAI({ apiKey });
 *   AFTER:  const openai = ExecutionOS.wrap(new OpenAI({ apiKey }), config);
 * 
 * If removed: direct calls bypass safety, cost explosions occur
 */

import { ExecutionOS, OSConfig, ExecutionIntent, ExecutionResult } from './ExecutionOS';

// Type definitions for SDK clients
interface OpenAIClient {
  chat: {
    completions: {
      create: (params: any) => Promise<any>;
    };
  };
  responses: {
    create: (params: any) => Promise<any>;
  };
  embeddings: {
    create: (params: any) => Promise<any>;
  };
}

interface AnthropicClient {
  messages: {
    create: (params: any) => Promise<any>;
  };
}

// Tracked method wrapper
interface WrappedMethod {
  original: Function;
  wrapped: Function;
  executionCount: number;
  lastExecution?: number;
}

/**
 * SDK Interception Layer
 * 
 * Wraps SDK clients to force all execution through ExecutionOS.
 * Creates mandatory dependency - removing wrapper breaks safety.
 */
export class SDKInterception {
  private os: ExecutionOS;
  private wrappedClients: Map<string, any> = new Map();
  private methodRegistry: Map<string, WrappedMethod> = new Map();
  
  constructor(os: ExecutionOS) {
    this.os = os;
  }

  /**
   * Wrap OpenAI client
   * Drop-in replacement that routes through ExecutionOS
   */
  wrapOpenAI(client: OpenAIClient, agentId: string, config?: Partial<OSConfig>): OpenAIClient {
    const key = `openai:${agentId}`;
    
    if (this.wrappedClients.has(key)) {
      return this.wrappedClients.get(key);
    }

    // Create wrapped client
    const wrapped = this.createWrappedOpenAI(client, agentId);
    
    // Store for tracking
    this.wrappedClients.set(key, wrapped);
    
    return wrapped;
  }

  /**
   * Wrap Anthropic client
   */
  wrapAnthropic(client: AnthropicClient, agentId: string, config?: Partial<OSConfig>): AnthropicClient {
    const key = `anthropic:${agentId}`;
    
    if (this.wrappedClients.has(key)) {
      return this.wrappedClients.get(key);
    }

    const wrapped = this.createWrappedAnthropic(client, agentId);
    this.wrappedClients.set(key, wrapped);
    
    return wrapped;
  }

  /**
   * Create wrapped OpenAI client
   * Intercepts all methods and routes through OS
   */
  private createWrappedOpenAI(client: OpenAIClient, agentId: string): OpenAIClient {
    const self = this;
    
    return {
      chat: {
        completions: {
          create: async (params: any) => {
            // Build execution intent
            const intent: ExecutionIntent = {
              type: 'llm',
              provider: 'openai',
              action: 'chat.completions.create',
              input: params,
              estimatedTokens: self.estimateTokens(params),
              estimatedCost: self.estimateOpenAICost(params),
              dependencies: [],
              sideEffects: ['api_call', 'token_consumption'],
            };

            // Execute through OS
            return self.executeThroughOS(agentId, intent, async () => {
              return client.chat.completions.create(params);
            });
          },
        },
      },
      responses: {
        create: async (params: any) => {
          const intent: ExecutionIntent = {
            type: 'llm',
            provider: 'openai',
            action: 'responses.create',
            input: params,
            estimatedTokens: self.estimateTokens(params),
            estimatedCost: self.estimateOpenAICost(params),
            dependencies: [],
            sideEffects: ['api_call', 'token_consumption'],
          };

          return self.executeThroughOS(agentId, intent, async () => {
            return client.responses.create(params);
          });
        },
      },
      embeddings: {
        create: async (params: any) => {
          const intent: ExecutionIntent = {
            type: 'llm',
            provider: 'openai',
            action: 'embeddings.create',
            input: params,
            estimatedTokens: params.input ? params.input.length / 4 : 1000,
            estimatedCost: self.estimateEmbeddingCost(params),
            dependencies: [],
            sideEffects: ['api_call', 'token_consumption'],
          };

          return self.executeThroughOS(agentId, intent, async () => {
            return client.embeddings.create(params);
          });
        },
      },
    };
  }

  /**
   * Create wrapped Anthropic client
   */
  private createWrappedAnthropic(client: AnthropicClient, agentId: string): AnthropicClient {
    const self = this;
    
    return {
      messages: {
        create: async (params: any) => {
          const intent: ExecutionIntent = {
            type: 'llm',
            provider: 'anthropic',
            action: 'messages.create',
            input: params,
            estimatedTokens: self.estimateTokens(params),
            estimatedCost: self.estimateAnthropicCost(params),
            dependencies: [],
            sideEffects: ['api_call', 'token_consumption'],
          };

          return self.executeThroughOS(agentId, intent, async () => {
            return client.messages.create(params);
          });
        },
      },
    };
  }

  /**
   * Execute through ExecutionOS
   * This is the CRITICAL method - creates mandatory dependency
   */
  private async executeThroughOS<T>(
    agentId: string,
    intent: ExecutionIntent,
    actualExecution: () => Promise<T>
  ): Promise<T> {
    // 1. Plan execution through OS (MUST pass)
    const plan = await this.os.plan(agentId, intent);

    // 2. Check if OS cleared execution
    const osResult = await this.os.execute(plan);

    if (osResult.status === 'blocked') {
      // Execution blocked by OS - throw error
      const error = new Error(
        `ExecutionOS blocked: ${osResult.explanation}\n` +
        `If you remove ExecutionOS, this would have executed unsafely.\n` +
        `Cost prevented: $${plan.totalEstimatedCost.toFixed(4)}`
      );
      (error as any).executionOSResult = osResult;
      (error as any).executionPlan = plan;
      throw error;
    }

    if (osResult.status === 'throttled') {
      // Execution throttled - apply delay
      await this.applyThrottle(plan);
    }

    // 3. OS cleared execution - now execute actual LLM call
    const startTime = Date.now();
    let actualResult: T | undefined;
    let actualCost = 0;
    let actualTokens = 0;
    let error: any = null;

    try {
      actualResult = await actualExecution();
      
      // Extract actual cost/tokens from result
      actualCost = this.extractActualCost(actualResult, intent.provider);
      actualTokens = this.extractActualTokens(actualResult, intent.provider);
    } catch (e) {
      error = e;
      throw e;
    } finally {
      // 4. Record result in OS (critical for data lock-in)
      const duration = Date.now() - startTime;
      
      await this.os.recordResult(plan.executionId, {
        status: error ? 'failed' : 'success',
        actualCost,
        actualTokens,
        durationMs: duration,
        error: error?.message,
        output: error ? undefined : actualResult,
      });
    }

    return actualResult!;
  }

  /**
   * Apply throttling delay
   */
  private async applyThrottle(plan: any): Promise<void> {
    const delay = 1000; // 1 second default
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Estimate tokens from params
   */
  private estimateTokens(params: any): number {
    if (params.messages) {
      return params.messages.reduce((sum: number, m: any) => {
        return sum + (m.content?.length || 0) / 4;
      }, 0) + (params.max_tokens || 1000);
    }
    if (params.prompt) {
      return params.prompt.length / 4 + (params.max_tokens || 1000);
    }
    return 2000; // Default
  }

  /**
   * Estimate OpenAI cost
   */
  private estimateOpenAICost(params: any): number {
    const tokens = this.estimateTokens(params);
    const model = params.model || 'gpt-4';
    
    // Rough estimates
    const pricing: Record<string, number> = {
      'gpt-4': 0.03,
      'gpt-4-turbo': 0.01,
      'gpt-3.5-turbo': 0.0015,
    };
    
    const per1k = pricing[model] || 0.01;
    return (tokens / 1000) * per1k;
  }

  /**
   * Estimate Anthropic cost
   */
  private estimateAnthropicCost(params: any): number {
    const tokens = this.estimateTokens(params);
    const model = params.model || 'claude-3-opus-20240229';
    
    const pricing: Record<string, number> = {
      'claude-3-opus': 0.015,
      'claude-3-sonnet': 0.003,
      'claude-3-haiku': 0.00025,
    };
    
    const per1k = pricing[model] || 0.008;
    return (tokens / 1000) * per1k;
  }

  /**
   * Estimate embedding cost
   */
  private estimateEmbeddingCost(params: any): number {
    const tokens = params.input ? params.input.length / 4 : 1000;
    return (tokens / 1000) * 0.0001; // $0.10 per 1M tokens
  }

  /**
   * Extract actual cost from API response
   */
  private extractActualCost(result: any, provider: string): number {
    if (provider === 'openai') {
      // Extract from usage
      const usage = result?.usage;
      if (usage) {
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const model = result.model || 'gpt-4';
        
        // Rough calculation
        const inputCost = (promptTokens / 1000) * 0.01;
        const outputCost = (completionTokens / 1000) * 0.03;
        return inputCost + outputCost;
      }
    }
    return 0;
  }

  /**
   * Extract actual tokens from API response
   */
  private extractActualTokens(result: any, provider: string): number {
    if (result?.usage?.total_tokens) {
      return result.usage.total_tokens;
    }
    return 0;
  }

  /**
   * Get interception statistics
   */
  getStats(): {
    wrappedClients: number;
    totalInterceptions: number;
  } {
    return {
      wrappedClients: this.wrappedClients.size,
      totalInterceptions: Array.from(this.methodRegistry.values())
        .reduce((sum, m) => sum + m.executionCount, 0),
    };
  }

  /**
   * Check if client is wrapped
   */
  isWrapped(client: any): boolean {
    return this.wrappedClients.has(`openai:${client}`) || 
           this.wrappedClients.has(`anthropic:${client}`);
  }
}

// Export convenience function
export function wrapOpenAI(
  os: ExecutionOS,
  client: OpenAIClient,
  agentId: string,
  config?: Partial<OSConfig>
): OpenAIClient {
  const interception = new SDKInterception(os);
  return interception.wrapOpenAI(client, agentId, config);
}

export function wrapAnthropic(
  os: ExecutionOS,
  client: AnthropicClient,
  agentId: string,
  config?: Partial<OSConfig>
): AnthropicClient {
  const interception = new SDKInterception(os);
  return interception.wrapAnthropic(client, agentId, config);
}
