/**
 * Starter Template: Serverless Protected Function
 * 
 * AWS Lambda / Vercel / Cloud Functions with automatic protection.
 * Already protected. Zero configuration. Production ready.
 */

export const STARTER_SERVERLESS_PROTECTED = {
  name: 'serverless-protected',
  description: 'Serverless function with automatic AI cost protection',
  
  files: {
    'package.json': JSON.stringify({
      name: 'serverless-ai-function',
      version: '1.0.0',
      type: 'module',
      dependencies: {
        'ai-costguard': '^2.0.0',
        'openai': '^4.0.0',
      },
    }, null, 2),

    'index.js': `// AI Cost Guard automatically activates on import
// All AI calls in this function are protected
import { OpenAI } from 'ai-costguard/openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(request) {
  const { message } = await request.json();
  
  // Protection is automatic
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: message }],
  });
  
  return new Response(
    JSON.stringify({
      reply: response.choices[0].message.content,
      protected: true,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
`,

    'vercel.json': JSON.stringify({
      functions: {
        'index.js': {
          maxDuration: 30,
        },
      },
    }, null, 2),

    '.env.example': `OPENAI_API_KEY=sk-...
AI_COSTGUARD_API_KEY=ak-...
`,

    'README.md': `# Protected Serverless Function

Serverless function with automatic AI cost explosion protection.

## Deploy

\`\`\`bash
npm install
vercel deploy
\`\`\`

All AI calls are automatically protected.

## How It Works

The import \`from 'ai-costguard/openai'\` activates automatic protection.
No configuration needed. Already protected on deployment.
`,
  },
};

export function generateServerlessStarter(): string {
  return JSON.stringify(STARTER_SERVERLESS_PROTECTED, null, 2);
}
