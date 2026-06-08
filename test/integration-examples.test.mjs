import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const examples = [
  'examples/integrations/openai-agent-loop.mjs',
  'examples/integrations/anthropic-workflow-budget.mjs',
  'examples/integrations/vercel-ai-chatbot.mjs',
  'examples/integrations/langchain-retry-storm.mjs',
  'examples/integrations/mastra-agent.mjs',
  'examples/integrations/crewai-budget-gate.mjs',
  'examples/integrations/ci-budget-check.mjs',
];

for (const example of examples) {
  test(`${example} runs without paid API calls`, () => {
    const result = spawnSync(process.execPath, [example], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.notEqual(result.stdout.trim(), '', `${example} should print a useful result`);
  });
}
