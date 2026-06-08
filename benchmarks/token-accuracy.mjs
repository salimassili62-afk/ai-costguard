import { estimateTokensFromText } from '../dist/core/tokenizer.js';

const corpus = [
  { label: 'short english', text: 'Summarize this ticket.', referenceTokens: 5 },
  {
    label: 'long english',
    text:
      'A customer reports that their nightly invoice reconciliation agent loops after a database timeout. ' +
      'Explain the likely failure mode and propose two safe remediation steps.',
    referenceTokens: 31,
  },
  { label: 'support summary', text: 'Summarize this support ticket in two bullets.', referenceTokens: 9 },
  {
    label: 'agent instruction',
    text: 'You are an agent. Use the search tool, then cite the result in JSON.',
    referenceTokens: 16,
  },
  {
    label: 'retry guard',
    text: 'The database migration failed with timeout 504. Retry only if the previous step is idempotent.',
    referenceTokens: 19,
  },
  {
    label: 'typescript code',
    text: 'function normalizeUser(user) { return { id: user.id, email: user.email?.toLowerCase() }; }',
    referenceTokens: 24,
  },
  {
    label: 'python code',
    text: 'def should_retry(error):\n    return error.status in {429, 500, 503} and error.attempts < 3',
    referenceTokens: 27,
  },
  {
    label: 'json config',
    text: '{"model":"gpt-4o-mini","max_tokens":400,"tools":[{"name":"search","strict":true}]}',
    referenceTokens: 25,
  },
  {
    label: 'markdown task',
    text: '## Release checklist\n- Run tests\n- Verify npm pack\n- Publish patch\n- Tag the release',
    referenceTokens: 22,
  },
  {
    label: 'arabic prompt',
    text: 'لخص محادثة الدعم هذه وحدد السبب الجذري والخطوة التالية.',
    referenceTokens: 18,
  },
  {
    label: 'french prompt',
    text: 'Explique pourquoi le budget de l’agent a été dépassé et propose une limite plus sûre.',
    referenceTokens: 20,
  },
  {
    label: 'repeated loop',
    text: 'retry retry retry retry retry retry retry retry retry retry',
    referenceTokens: 10,
  },
  {
    label: 'tool call like',
    text:
      'tool_call: {"name":"fetch_invoice","arguments":{"customerId":"cus_123","month":"2026-06"}} ' +
      'result: {"status":"timeout"}',
    referenceTokens: 34,
  },
  {
    label: 'agent loop like',
    text:
      'Step 12 failed. Try the same retrieval again with identical arguments, then repeat until the API returns data.',
    referenceTokens: 22,
  },
  {
    label: 'model comparison',
    text: 'Compare Claude Haiku and GPT-4o mini for a budget-sensitive chatbot.',
    referenceTokens: 17,
  },
  {
    label: 'customer apology',
    text: 'Write a concise customer apology for a delayed shipment and include one next step.',
    referenceTokens: 16,
  },
  {
    label: 'log line',
    text: 'Analyze these logs: ERROR rate_limit_exceeded request_id=req_123 retry_after=2s',
    referenceTokens: 24,
  },
  {
    label: 'interface request',
    text: 'Create a TypeScript interface for a webhook payload with cost, model, and reason fields.',
    referenceTokens: 17,
  },
  {
    label: 'sql query',
    text: 'SELECT tenant_id, SUM(cost_usd) FROM ai_events WHERE blocked = false GROUP BY tenant_id;',
    referenceTokens: 23,
  },
  {
    label: 'error stack',
    text: 'Error: Budget exceeded\n    at GuardCore.check (src/core/GuardCore.ts:144:11)\n    at agent.run (agent.ts:42:7)',
    referenceTokens: 33,
  },
  {
    label: 'anthropic workflow',
    text:
      'Claude should inspect the document, call the classifier once, and stop if confidence is below 0.7.',
    referenceTokens: 21,
  },
  {
    label: 'vercel chatbot',
    text:
      'streamText should answer the user only after the guard confirms the remaining session budget is sufficient.',
    referenceTokens: 19,
  },
  {
    label: 'ci budget check',
    text: 'npx aifw check --budget 1 --model gpt-4o-mini --tokens 800 --max-steps 20',
    referenceTokens: 29,
  },
  {
    label: 'mixed punctuation',
    text: 'Guard this: $$$, retries=3, model=gpt-4o-mini, scope=session:abc, max_tokens=250.',
    referenceTokens: 28,
  },
];

const samples = corpus.map((sample) => {
  const estimatedTokens = estimateTokensFromText(sample.text);
  const absoluteError = Math.abs(estimatedTokens - sample.referenceTokens);
  const percentError = (absoluteError / sample.referenceTokens) * 100;

  return {
    label: sample.label,
    estimatedTokens,
    referenceTokens: sample.referenceTokens,
    absoluteError,
    percentError: round(percentError, 2),
  };
});

const percentErrors = samples.map((sample) => sample.percentError).sort((a, b) => a - b);
const report = {
  generatedAt: new Date().toISOString(),
  reference: {
    tokenizer: 'fixed proxy fixture counts',
    note:
      'Reference counts are dependency-free proxy fixtures, not live provider tokenizers. Use this to understand estimator bias and boundaries, not to claim exact provider parity.',
  },
  sampleCount: samples.length,
  averageErrorPercent: round(average(percentErrors), 2),
  medianErrorPercent: round(median(percentErrors), 2),
  maxErrorPercent: Math.max(...percentErrors),
  markdownTable: formatMarkdownTable(samples),
  samples,
};

console.log(JSON.stringify(report, null, 2));

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values) {
  const midpoint = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[midpoint];
  return (values[midpoint - 1] + values[midpoint]) / 2;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatMarkdownTable(rows) {
  const lines = ['| sample | estimate | proxy | error | error % |', '| --- | ---: | ---: | ---: | ---: |'];

  for (const row of rows) {
    lines.push(
      `| ${row.label} | ${row.estimatedTokens} | ${row.referenceTokens} | ${row.absoluteError} | ${row.percentError}% |`
    );
  }

  return lines.join('\n');
}
