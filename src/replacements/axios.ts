/**
 * ai-costguard/axios - Drop-in Axios Replacement
 * 
 * Usage:
 *   import axios from 'ai-costguard/axios';
 * 
 * That's it. All HTTP calls are monitored.
 * 
 * Replaces axios with protected version that intercepts AI endpoints.
 */

// Import and immediately activate ambient protection
import '../ambient/AmbientProtection';

// Import original axios
import axios from 'axios';

// Add interceptor for AI endpoints
axios.interceptors.request.use((config) => {
  const url = config.url || '';
  
  // Check if AI endpoint
  if (url.includes('openai.com') || 
      url.includes('anthropic.com') || 
      url.includes('googleapis.com')) {
    console.log(`[AI Cost Guard] Axios intercept: ${url}`);
  }
  
  return config;
});

// Re-export
export default axios;

// Console confirmation
console.log('[AI Cost Guard] Axios execution secured');
