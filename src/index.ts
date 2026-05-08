/**
 * AI CostGuard — AI Agent Loop & Cost Firewall
 *
 * Detects infinite loops in autonomous AI agents and kills them
 * before they burn your API budget.
 *
 * Wraps your AI client. Enforces hard limits.
 * When it blocks, it tells you exactly how much it saved.
 *
 * @example
 * import { OpenAI } from 'openai';
 * import { withCostGuard } from '@salimassili/ai-costguard';
 *
 * const openai = withCostGuard(
 *   new OpenAI({ apiKey: 'sk-...' }),
 *   { maxTotalCostPerDay: 5.00 }
 * );
 */

export { withCostGuard, costGuardMiddleware, CostGuardError, getPricing } from './core/CostGuard.js';
export type { CostGuardConfig, RequestContext, GuardState } from './core/types.js';
