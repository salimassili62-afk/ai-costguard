/**
 * AI Cost Guard - Ambient Execution Safety Constraint for AI Systems
 * 
 * Runtime enforcement layer that activates automatically.
 * 
 * Usage:
 *   import 'ai-costguard'
 * 
 * That's it. Protection is now active. All AI calls are intercepted.
 * 
 * System identity: "Ambient execution safety constraint for AI systems"
 * NOT: tool, SDK, framework, product, middleware
 * YES: runtime enforcement layer (like TLS for AI)
 * 
 * Removing this import makes your AI execution unsafe.
 */

// === AUTO-ACTIVATE ON IMPORT ===
// Protection activates immediately when module is loaded
import { ambientProtection, getAmbientStatus } from './ambient/AmbientProtection';

// Console notification
console.log('[AI Cost Guard] Execution constraint active');
console.log('[AI Cost Guard] All AI calls will be intercepted');

// === DROP-IN REPLACEMENTS ===
// Replace your imports with protected versions

// Replace: import { OpenAI } from 'openai'
// With:    import { OpenAI } from 'ai-costguard/openai'
export { OpenAI } from './replacements/openai';

// Replace: import { fetch } from 'cross-fetch'
// With:    import { fetch } from 'ai-costguard/fetch'
export { fetch } from './replacements/fetch';

// Replace: import axios from 'axios'
// With:    import axios from 'ai-costguard/axios'
export { default as axios } from './replacements/axios';

// === STATUS CHECK ===
// Verify protection is active
export { getAmbientStatus };

// === PROJECT STARTERS ===
// Full working repos, already protected
export { STARTER_OPENAI_PROTECTED, generateOpenAIStarter } from './starters/openai-protected';
export { STARTER_EXPRESS_PROTECTED, generateExpressStarter } from './starters/express-protected';
export { STARTER_SERVERLESS_PROTECTED, generateServerlessStarter } from './starters/serverless-protected';
export { STARTER_LANGCHAIN_PROTECTED, generateLangChainStarter } from './starters/langchain-protected';

// === SELF-HOSTED INFRASTRUCTURE ===
// For running your own protection server
export { ProductionSaaS, startProductionSaaS } from './saas';

// === TRUST & VERIFICATION ===
// Public cryptographic proofs
export { publicLedger } from './trust/PublicVerificationLedger';

// === SYSTEM STATE ===
// Current protection status
export const protection = {
  active: true,
  status: getAmbientStatus(),
  message: 'Execution secured. AI calls intercepted.',
};

// Default export is the ambient protection singleton
export default ambientProtection;
