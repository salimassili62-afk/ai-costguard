/**
 * AI Execution Firewall - OpenAI SDK Example
 *
 * Shows how to wrap the OpenAI SDK with automatic firewall protection.
 */

import OpenAI from 'openai';
import { withFirewall, checkRequest } from '../src/wrapper/aiFirewall';

// Initialize OpenAI client with firewall protection
const openai = withFirewall(
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
  }),
  {
    // Optional: Customize firewall behavior
    trustMode: 'block', // 'monitor' | 'warn' | 'block'

    // Optional: Handle blocked requests
    onBlock: (reason: string, dangerScore: number) => {
      console.log(`🚫 Request blocked: ${reason} (danger score: ${dangerScore})`);
    },

    // Optional: Handle warnings
    onWarn: (reason: string, dangerScore: number) => {
      console.log(`⚠️  Warning: ${reason} (danger score: ${dangerScore})`);
    },
  }
);

async function main() {
  try {
    // Example 1: Safe request (should pass)
    console.log('=== Example 1: Safe Request ===');

    // Pre-flight check (optional)
    const preCheck = await checkRequest(
      'gpt-4',
      'Hello, how are you?',
      0.002
    );

    console.log('Pre-flight check:', preCheck);

    if (preCheck.allowed) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello, how are you?' }],
        max_tokens: 100,
      });

      console.log('Response:', response.choices[0].message.content);
    }

    // Example 2: Potentially dangerous request (might be blocked)
    console.log('\n=== Example 2: Loop Detection Test ===');

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'Hello' }, // Duplicate - might trigger loop detection
        ],
        max_tokens: 100,
      });

      console.log('Response:', response.choices[0].message.content);
    } catch (error: any) {
      if (error.blocked) {
        console.log('Request was blocked by firewall:', error.error.message);
      } else {
        console.error('Error:', error);
      }
    }

    // Example 3: High-cost request detection
    console.log('\n=== Example 3: Cost Spike Detection ===');

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'x'.repeat(10000) }], // Large request
        max_tokens: 4000,
      });

      console.log('Response:', response.choices[0].message.content);
    } catch (error: any) {
      if (error.blocked) {
        console.log('Request was blocked due to cost:', error.error.message);
      } else {
        console.error('Error:', error);
      }
    }

    // Get firewall statistics
    const { getFirewallStats } = await import('../src/wrapper/aiFirewall');
    const stats = await getFirewallStats(1);

    console.log('\n=== Firewall Statistics (Last 1 hour) ===');
    console.log(`Total Requests: ${stats.totalRequests}`);
    console.log(`Blocked: ${stats.blockedRequests}`);
    console.log(`Warned: ${stats.warnedRequests}`);
    console.log(`Cost Saved: $${stats.preventedCost.toFixed(4)}`);

  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { main };
