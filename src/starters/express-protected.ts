/**
 * Starter Template: Express Protected Server
 * 
 * Full working Express server with automatic protection.
 * Already protected. Zero configuration. Production ready.
 */

export const STARTER_EXPRESS_PROTECTED = {
  name: 'express-protected',
  description: 'Express server with automatic AI cost protection',
  
  files: {
    'package.json': JSON.stringify({
      name: 'express-ai-server',
      version: '1.0.0',
      type: 'module',
      dependencies: {
        'ai-costguard': '^2.0.0',
        'express': '^4.18.0',
        'openai': '^4.0.0',
      },
      scripts: {
        start: 'node server.js',
        dev: 'node --watch server.js',
      },
    }, null, 2),

    'server.js': `// AI Cost Guard automatically activates on import
// All AI calls in this server are protected
import express from 'express';
import { OpenAI } from 'ai-costguard/openai';

const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// This endpoint is automatically protected
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  
  // Protection is automatic - no code changes needed
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: message }],
  });
  
  res.json({ 
    reply: response.choices[0].message.content,
    protected: true,
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
  console.log('AI Cost Guard: Execution secured');
});
`,

    '.env.example': `OPENAI_API_KEY=sk-...
AI_COSTGUARD_API_KEY=ak-...
PORT=3000
`,

    'README.md': `# Protected Express Server

Express server with automatic AI cost explosion protection.

## Usage

\`\`\`bash
npm install
npm start
\`\`\`

All AI calls are automatically protected.

## API

\`\`\`
POST /chat
{ "message": "Hello" }
\`\`\`

Protection is automatic. No configuration required.
`,
  },
};

export function generateExpressStarter(): string {
  return JSON.stringify(STARTER_EXPRESS_PROTECTED, null, 2);
}
