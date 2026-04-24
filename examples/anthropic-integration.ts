/**
 * Anthropic Integration Example
 * 
 * This shows how to use AI Execution Firewall with Anthropic SDK
 */

import Anthropic from '@anthropic-ai/sdk';
import { AIExecutionFirewall } from 'ai-execution-firewall';

// Initialize the firewall
const firewall = new AIExecutionFirewall();

// Initialize Anthropic with your API key
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function main() {
  const messages = [
    { role: 'user', content: 'Explain quantum computing in simple terms' }
  ];

  // Wrap the Anthropic call with firewall protection
  const result = await firewall.call(
    async () => {
      return await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages,
      });
    },
    {
      model: 'claude-3-5-sonnet-20241022',
      messages,
    }
  );

  if (result.success && result.data) {
    console.log('Response:', result.data.content[0].text);
  } else if (result.blocked) {
    console.log('🔴 Request blocked:', result.reason);
    console.log('💰 Money saved:', result.savedAmount);
    if (result.killSwitchTriggered) {
      console.log('🚨 Kill switch was triggered');
    }
  }
}

main().catch(console.error);
