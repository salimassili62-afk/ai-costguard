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

## Current Local Result

Current local run:

- Date: `2026-06-08T13:03:42.459Z`
- Node: `v24.14.1`
- Platform: `win32`
- Iterations: `5000`
- Direct mocked async call: `0.000310 ms/call`
- Guarded mocked async call: `0.021001 ms/call`
- Added overhead: `0.020691 ms/call`
- Benign repeated "again" prompts blocked: `0`
- Repeated loop prompt blocked at step: `3`
- GC exposed for memory run: `false`

Do not quote benchmark numbers without the Node version, platform, iteration count, and date.

Generated benchmark output is intentionally not published in the npm package. Re-run the benchmark on your target runtime before using numbers in public claims.

## Interpreting Results

- `runtimeOverhead.addedPerCallMs` is the local overhead added by the guard wrapper in the benchmark request shape.
- `memoryOverhead.heapDeltaBytes` is noisy unless Node runs with `--expose-gc`.
- `falsePositiveScenarios.blocked` should remain `0` for the included benign repeated "again" prompts.
- `loopDetectionBehavior.blockedAtStep` should show when a repeated loop is stopped.
- `costEstimationBoundaries` reports this package's dependency-free estimator, not exact provider tokenizer output.
