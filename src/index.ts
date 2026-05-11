/**
 * AI CostGuard — RUNTIME FINANCIAL EXECUTION CONTROL LAYER
 * 
 * 🟦 FREE: Local illusion of safety (each process thinks it is safe)
 * 🟥 PAID: System-wide financial control (the system sees everything as one budget)
 * 
 * NOT: logging, monitoring, middleware, analytics
 * IS: distributed cost firewall for AI systems
 * 
 * @example
 * const ai = guard(openai)
 */

export { guard, GuardError, middleware, getPricing } from './core/GuardFree.js';
export { GuardPro, validateLicense, getProGuard } from './core/GuardPro.js';
export type { GuardConfig } from './core/types.js';
