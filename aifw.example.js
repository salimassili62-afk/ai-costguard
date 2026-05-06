// AI Execution Firewall - Node.js Example

import { withFirewall } from 'ai-execution-firewall';
import OpenAI from 'openai';

const openai = withFirewall(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  {
    trustMode: 'block',
    dailyBudget: 50,
    maxCost: 5,
  }
);

// Use normally
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
});
