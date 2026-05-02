/**
 * AI Execution Operating System (AIE-OS)
 * 
 * The mandatory execution layer for all autonomous AI agents.
 * 
 * This is NOT a tool. NOT optional. The execution layer itself.
 * 
 * Key Characteristics:
 * - Irreversible dependency: Agents cannot execute safely without it
 * - Network effects: Every deployment improves all others
 * - Ecosystem lock-in: Policy marketplace creates community dependency
 * - Data moat: Global intelligence improves continuously
 * - Category ownership: Becomes THE execution layer for AI agents
 * 
 * Usage:
 * ```typescript
 * import { ExecutionOS, wrapOpenAI } from 'ai-execution-os';
 * 
 * // Initialize OS
 * const os = new ExecutionOS({
 *   tenantId: 'my-org',
 *   mode: 'strict',
 *   defaultBudget: 100,
 * });
 * 
 * // Wrap SDK (mandatory for safe execution)
 * const openai = wrapOpenAI(os, new OpenAI({ apiKey }), 'my-agent');
 * 
 * // All calls now route through ExecutionOS
 * const result = await openai.chat.completions.create({...});
 * 
 * // Removing OS = bypassing safety = cost explosions
 * ```
 */

// Core OS
export {
  ExecutionOS,
  executionOS,
  OSConfig,
  ExecutionOSMode,
  ExecutionPhase,
  SafetyLevel,
  AgentIdentity,
  ExecutionContext,
  ExecutionIntent,
  ExecutionPlan,
  ExecutionStep,
  ExecutionResult,
  SafetyCheck,
} from './ExecutionOS';

// SDK Interception
export {
  SDKInterception,
  wrapOpenAI,
  wrapAnthropic,
} from './SDKInterception';

// Global Intelligence
export {
  GlobalIntelligence,
  globalIntelligence,
  PatternType,
  PatternSignature,
  GlobalPattern,
  IntelligenceContribution,
  IntelligenceReport,
  GlobalDetectionImprovement,
} from './GlobalIntelligence';

// Policy Marketplace
export {
  PolicyMarketplace,
  policyMarketplace,
  PolicyCategory,
  PolicyStatus,
  MarketplacePolicy,
  PolicyRuleDefinition,
  PolicyPublisher,
  PolicyReview,
  PolicyTemplate,
} from './PolicyMarketplace';

// Convenience: Combined API for easy usage
import { ExecutionOS } from './ExecutionOS';
import { SDKInterception } from './SDKInterception';

/**
 * Quick start helper - wraps everything together
 */
export function createExecutionOS(config: {
  tenantId: string;
  openAI?: { client: any; agentId: string };
  anthropic?: { client: any; agentId: string };
  mode?: 'strict' | 'permissive' | 'audit';
  budget?: number;
}): {
  os: ExecutionOS;
  openai?: any;
  anthropic?: any;
} {
  const os = new ExecutionOS({
    tenantId: config.tenantId,
    mode: config.mode || 'strict',
    defaultBudget: config.budget || 100,
    strictMode: true,
    globalIntelligence: true,
    policyAutoApply: true,
  });

  const result: any = { os };

  if (config.openAI) {
    const interceptor = new SDKInterception(os);
    result.openai = interceptor.wrapOpenAI(config.openAI.client, config.openAI.agentId);
  }

  if (config.anthropic) {
    const interceptor = new SDKInterception(os);
    result.anthropic = interceptor.wrapAnthropic(config.anthropic.client, config.anthropic.agentId);
  }

  return result;
}
