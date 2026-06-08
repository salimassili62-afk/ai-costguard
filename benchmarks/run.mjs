import { performance } from 'node:perf_hooks';
import { guardFunction } from '../dist/index.js';
import { GuardCore, GuardError } from '../dist/core/GuardCore.js';
import { estimateRequestTokens } from '../dist/core/tokenizer.js';

const iterations = readIterations(process.argv.slice(2));

const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  iterations,
  runtimeOverhead: await measureRuntimeOverhead(iterations),
  memoryOverhead: await measureMemoryOverhead(Math.max(250, Math.min(iterations, 2000))),
  falsePositiveScenarios: measureFalsePositiveScenarios(),
  loopDetectionBehavior: measureLoopDetectionBehavior(),
  costEstimationBoundaries: measureCostEstimationBoundaries(),
};

console.log(JSON.stringify(result, null, 2));

async function measureRuntimeOverhead(count) {
  async function directCall(request) {
    return { ok: true, usage: { prompt_tokens: 12, completion_tokens: request.max_tokens ?? 8 } };
  }

  const guardedCall = guardFunction(directCall, {
    budget: 1_000,
    behaviorAnalysis: false,
    scope: { projectId: 'benchmark' },
  });

  const request = {
    model: 'gpt-4o-mini',
    prompt: 'benchmark request',
    max_tokens: 8,
  };

  await warmup(directCall, guardedCall, request);

  const directMs = await timeAsync(count, () => directCall(request));
  const guardedMs = await timeAsync(count, () => guardedCall(request));
  const directPerCallMs = directMs / count;
  const guardedPerCallMs = guardedMs / count;

  return {
    directTotalMs: round(directMs, 3),
    guardedTotalMs: round(guardedMs, 3),
    directPerCallMs: round(directPerCallMs, 6),
    guardedPerCallMs: round(guardedPerCallMs, 6),
    addedPerCallMs: round(guardedPerCallMs - directPerCallMs, 6),
  };
}

async function measureMemoryOverhead(count) {
  const guardedCall = guardFunction(
    async (request) => ({ ok: true, usage: { prompt_tokens: 12, completion_tokens: request.max_tokens ?? 8 } }),
    {
      budget: 1_000,
      maxHistory: count,
      loopMinRepeats: count + 1,
      scope: { projectId: 'memory-benchmark' },
    }
  );

  collectGarbageIfAvailable();
  const beforeBytes = process.memoryUsage().heapUsed;

  for (let index = 0; index < count; index++) {
    await guardedCall({
      model: 'gpt-4o-mini',
      prompt: `memory benchmark unique prompt ${index}`,
      max_tokens: 8,
    });
  }

  collectGarbageIfAvailable();
  const afterBytes = process.memoryUsage().heapUsed;

  return {
    calls: count,
    heapDeltaBytes: afterBytes - beforeBytes,
    heapDeltaPerCallBytes: round((afterBytes - beforeBytes) / count, 2),
    gcAvailable: typeof globalThis.gc === 'function',
    note: 'Heap measurements are process-local and noisy unless Node is run with --expose-gc.',
  };
}

function measureFalsePositiveScenarios() {
  const core = new GuardCore({
    budget: 1,
    retryThreshold: 2,
    loopSimilarityThreshold: 0.9,
    scope: { projectId: 'false-positive-benchmark' },
  });
  const prompts = [
    'again compare the two product options',
    'again summarize the second option with different tradeoffs',
    'again write a new title for the launch note',
  ];
  let blocked = 0;

  for (const prompt of prompts) {
    try {
      core.check(context(prompt));
    } catch (error) {
      if (error instanceof GuardError) blocked += 1;
      else throw error;
    }
  }

  return {
    scenario: 'Repeated benign "again" prompts without failure/error language',
    prompts: prompts.length,
    blocked,
  };
}

function measureLoopDetectionBehavior() {
  const core = new GuardCore({
    budget: 1,
    loopSimilarityThreshold: 0.9,
    loopMinRepeats: 2,
    scope: { projectId: 'loop-benchmark' },
  });
  const prompt = 'summarize the same tool observation and continue the agent plan';

  for (let step = 1; step <= 5; step++) {
    try {
      core.check(context(prompt));
    } catch (error) {
      if (error instanceof GuardError) {
        return {
          repeatedPrompt: prompt,
          blockedAtStep: step,
          code: error.code,
          reason: error.message,
        };
      }

      throw error;
    }
  }

  return {
    repeatedPrompt: prompt,
    blockedAtStep: null,
  };
}

function measureCostEstimationBoundaries() {
  const samples = [
    { label: 'short chat', request: { messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 } },
    {
      label: 'long instruction',
      request: {
        messages: [{ role: 'user', content: 'Summarize the following requirements. '.repeat(120) }],
        max_tokens: 256,
      },
    },
    {
      label: 'code-heavy prompt',
      request: {
        prompt: 'function example(value) { return value.map((item) => item.id).join(","); }\n'.repeat(40),
        max_tokens: 128,
      },
    },
  ];

  return {
    tokenizer: 'dependency-free estimator',
    doesNotClaimProviderExactness: true,
    samples: samples.map((sample) => {
      const estimate = estimateRequestTokens(sample.request);
      return {
        label: sample.label,
        inputTokens: estimate.inputTokens,
        outputTokens: estimate.outputTokens,
        totalTokens: estimate.tokens,
      };
    }),
  };
}

async function warmup(directCall, guardedCall, request) {
  for (let index = 0; index < 100; index++) {
    await directCall(request);
    await guardedCall(request);
  }
}

async function timeAsync(count, fn) {
  const start = performance.now();
  for (let index = 0; index < count; index++) {
    await fn();
  }
  return performance.now() - start;
}

function context(prompt) {
  return {
    model: 'gpt-4o-mini',
    pricingKnown: true,
    tokens: 100,
    inputTokens: 40,
    outputTokens: 60,
    estimatedCost: 0.0001,
    timestamp: Date.now(),
    prompt,
  };
}

function collectGarbageIfAvailable() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
}

function readIterations(args) {
  const index = args.indexOf('--iterations');
  if (index === -1) return 5000;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 5000;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
