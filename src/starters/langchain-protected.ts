/**
 * Starter Template: LangChain Protected Project
 * 
 * Full working LangChain app with automatic cost protection.
 * Already protected. Zero configuration. Production ready.
 */

export const STARTER_LANGCHAIN_PROTECTED = {
  name: 'langchain-protected',
  description: 'LangChain project with automatic AI cost protection',
  
  files: {
    'package.json': JSON.stringify({
      name: 'langchain-ai-app',
      version: '1.0.0',
      type: 'module',
      dependencies: {
        'ai-costguard': '^2.0.0',
        'langchain': '^0.1.0',
        '@langchain/openai': '^0.0.14',
      },
      scripts: {
        start: 'node app.js',
        dev: 'node --watch app.js',
      },
    }, null, 2),

    'app.js': `// AI Cost Guard automatically activates on import
// All LangChain AI calls are protected
import 'ai-costguard';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';

const model = new ChatOpenAI({
  modelName: 'gpt-4',
  openAIApiKey: process.env.OPENAI_API_KEY,
});

const prompt = ChatPromptTemplate.fromMessages([
  ['system', 'You are a helpful assistant.'],
  ['user', '{input}'],
]);

const chain = prompt.pipe(model);

// This call is automatically protected
const response = await chain.invoke({
  input: 'What is the weather like?',
});

console.log(response.content);
`,

    '.env.example': `OPENAI_API_KEY=sk-...
AI_COSTGUARD_API_KEY=ak-...
`,

    'README.md': `# Protected LangChain Project

LangChain application with automatic AI cost explosion protection.

## Usage

\`\`\`bash
npm install
npm start
\`\`\`

That's it. Protection is automatically active.

## How It Works

The import \`'ai-costguard'\` at the top of the file automatically:
1. Activates runtime protection
2. Intercepts all AI calls (including LangChain's)
3. Blocks cost explosions
4. Logs all activity

No configuration. No setup. Already protected.
`,
  },
};

export function generateLangChainStarter(): string {
  return JSON.stringify(STARTER_LANGCHAIN_PROTECTED, null, 2);
}
