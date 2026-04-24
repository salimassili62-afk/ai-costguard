/**
 * Proxy Integration Example
 * 
 * This shows how to use AI Execution Firewall proxy with OpenAI SDK
 */

import OpenAI from 'openai';

// Configure OpenAI to use the firewall proxy
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://localhost:3000/v1', // Point to AI Execution Firewall proxy
});

async function main() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello!' }],
    });
    
    console.log('Response:', response.choices[0].message.content);
  } catch (error: any) {
    if (error.response?.data?.blocked) {
      console.log('🔴 Request blocked by firewall');
      console.log('Reason:', error.response.data.error);
      if (error.response.data.killSwitchTriggered) {
        console.log('🚨 Kill switch was triggered');
      }
    } else {
      console.error('Error:', error.message);
    }
  }
}

main().catch(console.error);
