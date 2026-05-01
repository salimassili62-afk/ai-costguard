/**
 * AI Execution Firewall - SDK Wrapper
 *
 * Main entry point for using the firewall as a middleware layer.
 * Re-exports and consolidates all firewall wrapping functionality.
 *
 * Usage:
 *   import { withFirewall } from 'ai-execution-firewall';
 *
 *   // Wrap OpenAI client
 *   const openai = withFirewall(new OpenAI({ apiKey: '...' }));
 *
 *   // Use normally - firewall intercepts automatically
 *   const response = await openai.chat.completions.create({
 *     model: 'gpt-4',
 *     messages: [{ role: 'user', content: 'Hello' }]
 *   });
 *
 *   // With custom handlers
 *   const openai = withFirewall(new OpenAI({...}), {
 *     onBlock: (reason, score) => console.log('Blocked:', reason),
 *     onWarn: (reason, score) => console.log('Warning:', reason)
 *   });
 */

// Re-export from middleware modules
export {
  withFirewall,
  wrapFunction,
  withFetchFirewall,
  FirewallOptions,
  OpenAIRequest,
  ChatMessage,
  FetchLike,
} from '../middleware/withFirewall';

export {
  expressFirewall,
  withFirewallHandler,
  FirewallMiddlewareOptions,
  AIRequestBody,
} from '../middleware/expressFirewall';

// Also export the main class for advanced usage
export { AIExecutionFirewall } from './sdk';

// Export detection engine and alert hooks for custom integrations
export { detectionEngine, AlertHooks, DetectionResult, AnalyzeInput } from '../core/DetectionEngine';
export { policyEngine, BudgetStatus, EffectivePolicy } from '../core/PolicyEngine';
export { FirewallMetadata, TokenBreakdown } from '../core/types';
export { createStorageAdapter, StorageAdapter, MemoryStorageAdapter, JsonlStorageAdapter } from '../storage';

// Export configuration for budget protection and settings
export { ConfigManager, registerPricingModel, getModelPricing, listPricingModels } from '../config';

/**
 * Convenience function to check if a request would be blocked
 * Useful for pre-flight checks before actual API calls
 */
export async function checkRequest(
  model: string,
  prompt: string,
  estimatedCost?: number,
  metadata?: import('../core/types').FirewallMetadata
): Promise<{
  allowed: boolean;
  blocked: boolean;
  dangerScore: number;
  reason: string;
  category: string;
  requestId?: string;
  policyId?: string;
}> {
  const { detectionEngine } = await import('../core/DetectionEngine');
  const { ConfigManager } = await import('../config');

  const config = new ConfigManager();

  const result = detectionEngine.analyze({
    model,
    prompt,
    estimatedCost: estimatedCost || 0,
    trustMode: config.trustMode,
    override: false,
    metadata,
  });

  return {
    allowed: result.decision === 'allow',
    blocked: result.decision === 'block',
    dangerScore: result.dangerScore,
    reason: result.reason,
    category: result.category,
    requestId: result.metadata.requestId,
    policyId: result.metadata.policyId,
  };
}

export async function recordActualUsage(ledgerId: string, apiResponse: any, model: string): Promise<boolean> {
  const { costLedger } = await import('../core/CostLedger');
  return costLedger.recordActualFromResponse(ledgerId, apiResponse, model);
}

export async function explainDecision(result: import('../core/DetectionEngine').DetectionResult): Promise<string> {
  const { detectionEngine } = await import('../core/DetectionEngine');
  return detectionEngine.explainDecision(result);
}

export async function getBudgetStatus(
  metadata: import('../core/types').FirewallMetadata = {}
): Promise<import('../core/PolicyEngine').BudgetStatus> {
  const { policyEngine } = await import('../core/PolicyEngine');
  return policyEngine.getBudgetStatus(metadata);
}

/**
 * Get current firewall statistics
 */
export async function getFirewallStats(hours: number = 24): Promise<{
  totalRequests: number;
  blockedRequests: number;
  warnedRequests: number;
  totalCost: number;
  preventedCost: number;
  actualCost: number;
  totalTokens: number;
}> {
  const { detectionEngine } = await import('../core/DetectionEngine');
  return detectionEngine.getStats(hours);
}
