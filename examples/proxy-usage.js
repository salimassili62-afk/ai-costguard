/**
 * Proxy Usage Example
 * 
 * This shows how to configure your AI SDK to use the AI Waste Guard proxy
 */

// OpenAI Example
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://localhost:3000/v1', // Point to AI Waste Guard proxy
});

// Use as normal - waste detection happens automatically
async function example() {
  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: 'Hello!' }],
  });
  
  console.log(response.choices[0].message.content);
}

// Anthropic Example
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'http://localhost:3000', // Point to AI Waste Guard proxy
});

async function anthropicExample() {
  const response = await anthropic.messages.create({
    model: 'claude-3-sonnet-20240229',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }],
  });
  
  console.log(response.content[0].text);
}

module.exports = { example, anthropicExample };
