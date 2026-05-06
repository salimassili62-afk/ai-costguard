/**
 * ai-costguard/openai - Drop-in OpenAI Replacement
 * 
 * Usage:
 *   import { OpenAI } from 'ai-costguard/openai';
 * 
 * That's it. Protection is automatically active.
 * 
 * This is NOT integration. This is replacement.
 * Developers replace 'openai' with 'ai-costguard/openai'.
 */

// Import and immediately activate ambient protection
import '../ambient/AmbientProtection';

// Re-export from original OpenAI
export { OpenAI } from 'openai';

// Console confirmation
console.log('[AI Cost Guard] OpenAI SDK execution secured');
