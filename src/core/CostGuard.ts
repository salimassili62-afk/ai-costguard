/**
 * CostGuard.ts - RUNTIME FINANCIAL EXECUTION CONTROL LAYER
 * 
 * 🟦 FREE: Local illusion of safety (each process thinks it is safe)
 * 🟥 PAID: System-wide financial control (the system sees everything as one budget)
 * 
 * NOT: logging, monitoring, middleware, analytics
 * IS: distributed cost firewall for AI systems
 */

export { guard, GuardError, middleware, getPricing } from './GuardFree.js';
export { GuardPro, validateLicense, getProGuard } from './GuardPro.js';
export type { GuardConfig } from './types.js';
