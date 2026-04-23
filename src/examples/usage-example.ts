/**
 * Usage Example: SDK Wrapper
 * 
 * This shows how to integrate AI Waste Guard with your existing OpenAI/Anthropic code
 */

import { AIWasteGuard } from '../wrapper';
// import OpenAI from 'openai'; // Uncomment if you have openai installed

// Initialize AI Waste Guard
const guard = new AIWasteGuard();

// Initialize OpenAI (or Anthropic)
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// Example 1: Using with OpenAI
async function callOpenAIWithGuard() {
  const messages = [
    { role: 'user', content: 'Explain TypeScript in simple terms' }
  ];
  
  // Uncomment when you have openai installed
  /*
  const result = await guard.callOpenAI(
    async () => {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages,
      });
      return response;
    },
    'gpt-3.5-turbo',
    messages
  );
  
  if (result.success && result.data) {
    console.log('Response:', result.data.choices[0].message.content);
  } else if (result.blocked) {
    console.log('Request blocked:', result.reason);
    console.log('Suggestions:', result.suggestions);
  }
  */
}

// Example 2: Using with custom API call
async function customAPICall() {
  const result = await guard.call(
    async () => {
      // Your custom API call here
      return { data: 'response' };
    },
    {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Your prompt here' }],
      context: 'Optional context for waste detection'
    }
  );
  
  if (result.success) {
    console.log('API call succeeded:', result.data);
  }
}

// Example 3: Updating configuration
function updateConfiguration() {
  guard.updateConfig({
    blockMode: true,
    maxCostPerRequest: 0.50,
    wasteThreshold: 60
  });
}

// Example 4: Getting statistics
function showStatistics() {
  const stats = guard.getStats(24); // Last 24 hours
  console.log('Statistics:', stats);
}

// Export for use
export { callOpenAIWithGuard, customAPICall, updateConfiguration, showStatistics };
