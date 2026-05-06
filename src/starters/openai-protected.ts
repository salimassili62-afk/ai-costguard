/**
 * Starter Template: OpenAI Protected Project
 * 
 * Full working repo structure for instant deployment.
 * Already protected. Zero configuration. Production ready.
 */

export const STARTER_OPENAI_PROTECTED = {
  name: 'openai-protected',
  description: 'OpenAI project with automatic cost protection',
  
  files: {
    'package.json': JSON.stringify({
      name: 'my-ai-project',
      version: '1.0.0',
      type: 'module',
      dependencies: {
        'ai-costguard': '^2.0.0',
        'openai': '^4.0.0',
      },
      scripts: {
        start: 'node index.js',
        dev: 'node --watch index.js',
      },
    }, null, 2),

    'index.js': `// AI Cost Guard automatically activates on import
// No configuration required. No setup needed.
import { OpenAI } from 'ai-costguard/openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// This call is automatically protected
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
});

console.log(response.choices[0].message.content);
`,

    '.env.example': `# Copy to .env and fill in your keys
OPENAI_API_KEY=sk-...
AI_COSTGUARD_API_KEY=ak-...
`,

    'README.md': `# Protected OpenAI Project

This project has automatic cost explosion protection built-in.

## Usage

\`\`\`bash
npm install
npm start
\`\`\`

That's it. Protection is automatically active.

## How It Works

The import \`from 'ai-costguard/openai'\` automatically:
1. Activates runtime protection
2. Intercepts all AI calls
3. Blocks cost explosions
4. Logs all activity

No configuration. No setup. Already protected.
`,
  },

  instructions: [
    '1. Copy these files to a new directory',
    '2. Run: npm install',
    '3. Copy .env.example to .env and add your keys',
    '4. Run: npm start',
    '',
    'Result: Project is running with automatic cost protection',
  ].join('\n'),
};

export function generateOpenAIStarter(): string {
  return JSON.stringify(STARTER_OPENAI_PROTECTED, null, 2);
}
