# Benchmarks

Benchmarks are local measurements, not universal guarantees. Hardware, Node version, model request shape, history size, and enabled behavior checks all matter.

Run:

```bash
npm run build
npm run benchmark
```

For shorter sanity runs:

```bash
node benchmarks/run.mjs --iterations 500
```

The benchmark script measures:

- Runtime overhead per guarded function call
- Approximate heap delta after guarded calls
- Benign false-positive scenario for repeated "again" prompts
- Loop detection block step for repeated prompts
- Cost-estimation sample boundaries

Token accuracy benchmark:

```bash
npm run build
npm run benchmark:tokens
```

## Current Local Result

Current local run:

- Date: `2026-06-08T19:54:52.399Z`
- Node: `v24.14.1`
- Platform: `win32`
- Iterations: `5000`
- Direct mocked async call: `0.000409 ms/call`
- Guarded mocked async call: `0.024346 ms/call`
- Added overhead: `0.023937 ms/call`
- Benign repeated "again" prompts blocked: `0`
- Repeated loop prompt blocked at step: `3`
- GC exposed for memory run: `false`

Do not quote benchmark numbers without the Node version, platform, iteration count, and date.

Generated benchmark output is intentionally not published in the npm package. Re-run the benchmark on your target runtime before using numbers in public claims.

## Token Accuracy Result

Current fixed-corpus token accuracy run:

- Reference: dependency-free fixed proxy fixture counts, not a live provider tokenizer
- Samples: `24`
- Average error: `237.76%`
- Median error: `240.06%`
- Max error: `390%`

This shows the current dependency-free estimator is conservative and materially overestimates this proxy corpus. Treat AI CostGuard estimates as pre-call guardrails, not exact provider tokenizer counts. For production budgets that need tighter input-token estimates, register an exact tokenizer with `registerTokenizer()`.

## Interpreting Results

- `runtimeOverhead.addedPerCallMs` is the local overhead added by the guard wrapper in the benchmark request shape.
- `memoryOverhead.heapDeltaBytes` is noisy unless Node runs with `--expose-gc`.
- `falsePositiveScenarios.blocked` should remain `0` for the included benign repeated "again" prompts.
- `loopDetectionBehavior.blockedAtStep` should show when a repeated loop is stopped.
- `costEstimationBoundaries` reports this package's dependency-free estimator, not exact provider tokenizer output.
