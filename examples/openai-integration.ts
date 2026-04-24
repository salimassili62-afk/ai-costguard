/**
 * OpenAI Integration Example
 * 
 * This shows how to use AI Execution Firewall with OpenAI SDK
 */

import OpenAI from 'openai';
import { AIExecutionFirewall } from 'ai-execution-firewall';

// Initialize the firewall
const firewall = new AIExecutionFirewall();

// Initialize OpenAI with your API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  const messages = [
    { role: 'user', content: 'Explain quantum computing in simple terms' }
  ];

  // Wrap the OpenAI call with firewall protection
  const result = await firewall.call(
    async () => {
      return await openai.chat.completions.create({
        model: 'gpt-4',
        messages,
      });
    },
    {
      model: 'gpt-4',
      messages,
    }
  );

  if (result.success && result.data) {
    console.log('Response:', result.data.choices[0].message.content);
  } else if (result.blocked) {
    console.log('🔴 Request blocked:', result.reason);
    console.log('💰 Money saved:', result.savedAmount);
    if (result.killSwitchTriggered) {
      console.log('🚨 Kill switch was triggered');
    }
  }
}

main().catch(console.error);
