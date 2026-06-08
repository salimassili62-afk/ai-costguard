import { estimateTokensFromText } from '../dist/core/tokenizer.js';

const corpus = [
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
    tokenizer: 'gpt-tokenizer cl100k_base fixture counts',
    note:
      'Reference counts are fixed corpus fixtures, not live provider calls. Use this to understand estimator bias, not to claim exact tokenizer parity.',
  },
  sampleCount: samples.length,
  averageErrorPercent: round(average(percentErrors), 2),
  medianErrorPercent: round(median(percentErrors), 2),
  maxErrorPercent: Math.max(...percentErrors),
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
