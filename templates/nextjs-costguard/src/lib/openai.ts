/**
 * OpenAI client with AI CostGuard protection
 * This file wraps the OpenAI SDK with automatic cost protection
 */

import OpenAI from 'openai';
import { guard } from '@salimassili/ai-costguard';

// Create protected OpenAI client
export const openai = guard(
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }),
  {
    budget: 50,
    scope: { projectId: 'nextjs-template' },
  }
);

// Type export for use in API routes
export type { OpenAI };
