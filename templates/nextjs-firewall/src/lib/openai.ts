/**
 * OpenAI client with AI Execution Firewall protection
 * This file wraps the OpenAI SDK with automatic cost protection
 */

import OpenAI from 'openai';
import { withFirewall } from 'ai-execution-firewall';

// Create protected OpenAI client
export const openai = withFirewall(
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }),
  {
    trustMode: 'block', // 'monitor' | 'warn' | 'block'
    maxCost: 5.0, // Max $5 per request
    dailyBudget: 50, // Daily limit

    // Real-time alerts
    onBlock: (reason: string, dangerScore: number, estimatedCost: number) => {
      console.error('🔥 AI FIREWALL BLOCKED:', reason);
      console.error(`   Danger Score: ${dangerScore}`);
      console.error(`   SAVED: $${estimatedCost.toFixed(4)}`);
    },

    onWarn: (reason: string, dangerScore: number, estimatedCost: number) => {
      console.warn('⚠️  AI FIREWALL WARNING:', reason);
      console.warn(`   Danger Score: ${dangerScore}`);
      console.warn(`   Cost: $${estimatedCost.toFixed(4)}`);
    },

    onSpike: (requests: number, timeWindow: number) => {
      console.error(`🚨 SPIKE DETECTED: ${requests} requests in ${timeWindow}s`);
    },
  }
);

// Type export for use in API routes
export type { OpenAI };
