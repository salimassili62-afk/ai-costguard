/**
 * ai-costguard/fetch - Drop-in Fetch Replacement
 * 
 * Usage:
 *   import { fetch } from 'ai-costguard/fetch';
 * 
 * That's it. All AI API calls are intercepted.
 * 
 * Replaces global fetch with protected version.
 */

// Import and immediately activate ambient protection
import '../ambient/AmbientProtection';

// Export the now-protected global fetch
export const fetch = globalThis.fetch;

// Console confirmation
console.log('[AI Cost Guard] Global fetch execution secured');
