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
  FirewallOptions,
  OpenAIRequest,
  ChatMessage,
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
export { detectionEngine, AlertHooks } from '../core/DetectionEngine';

// Export configuration for budget protection and settings
export { ConfigManager } from '../config';

/**
 * Convenience function to check if a request would be blocked
 * Useful for pre-flight checks before actual API calls
 */
export async function checkRequest(
  model: string,
  prompt: string,
  estimatedCost?: number
): Promise<{
  allowed: boolean;
  blocked: boolean;
  dangerScore: number;
  reason: string;
  category: string;
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
  });

  return {
    allowed: result.decision === 'allow',
    blocked: result.decision === 'block',
    dangerScore: result.dangerScore,
    reason: result.reason,
    category: result.category,
  };
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
}> {
  const { detectionEngine } = await import('../core/DetectionEngine');
  return detectionEngine.getStats(hours);
}

/**
 * ROI-oriented KPI metrics for product dashboards and billing narratives.
 */
export async function getFirewallMetrics(hours: number = 24): Promise<{
  total_cost_saved: number;
  blocked_requests_count: number;
  false_positive_indicator: number;
  avg_analysis_latency_ms: number;
  storage_backend: 'file' | 'redis';
}> {
  const { detectionEngine } = await import('../core/DetectionEngine');
  return detectionEngine.getOperationalMetrics(hours);
}
