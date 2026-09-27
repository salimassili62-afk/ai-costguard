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

- Date: `2026-09-27T18:48:29.743Z`
- Node: `v24.14.1`
- Platform: `win32`
- Iterations: `5000`
- Direct mocked async call: `0.000465 ms/call`
- Guarded mocked async call: `0.030417 ms/call`
- Added overhead: `0.029952 ms/call`
- Heap delta: `64944` bytes over `2000` calls (`32.47` bytes/call, GC not exposed)
- Benign repeated "again" prompts blocked: `0`
- Repeated loop prompt blocked at step: `3` (`LOOP_DETECTED`)
- GC exposed for memory run: `false`

Do not quote benchmark numbers without the Node version, platform, iteration count, and date.

### Run-to-Run Variance

`addedPerCallMs` is a difference of two wall-clock totals, so it is noisy. Six consecutive runs of
the same binary on the same machine produced `0.021158`, `0.023418`, `0.026784`, `0.042931`,
`0.022413`, and `0.029952` ms/call — a median of `0.025101` and a spread of roughly `2x` between the
fastest and slowest run. Quote a range, never a single decimal, and never present a difference of two
timings as a hard guarantee.

`heapDeltaBytes` is not reproducible on this machine at all without `--expose-gc`: the same six runs
reported `3034664`, `1030392`, `2498824`, `2932976`, `1205984`, and `64944` bytes — a `45x` spread
driven entirely by when a GC happened to fire. Treat any single heap figure as noise. Re-run with
`node --expose-gc` if a memory number actually matters.

The previously published `0.023937 ms/call` figure falls inside the range above, so the accounting
and concurrency work in `2.3.0` did not measurably change guard overhead. It also was not meant to:
the added work is one rounding function call per accumulation point, not a new code path.

Generated benchmark output is intentionally not published in the npm package. Re-run the benchmark on your target runtime before using numbers in public claims.

## Token Accuracy Result

Current fixed-corpus token accuracy run:

- Reference: dependency-free fixed proxy fixture counts, not a live provider tokenizer
- Samples: `24`
- Average error: `9.68%`
- Median error: `11.43%`
- Max error: `28.57%` (`anthropic workflow`, `27` estimated vs `21` reference)

Non-Latin scripts are in the corpus on purpose. The Arabic sample is estimated exactly (`18` vs
`18`); the estimator counts characters, so it degrades where a provider's BPE does not. If a guard
budget depends on input tokens for non-Latin text, register an exact tokenizer with
`registerTokenizer()` and validate it on your own corpus.

This shows the calibrated dependency-free estimator is much closer on this proxy corpus. Treat AI CostGuard estimates as pre-call guardrails, not exact provider tokenizer counts. For production budgets that need tighter input-token estimates, register an exact tokenizer with `registerTokenizer()`.

## Interpreting Results

- `runtimeOverhead.addedPerCallMs` is the local overhead added by the guard wrapper in the benchmark request shape.
- `memoryOverhead.heapDeltaBytes` is noisy unless Node runs with `--expose-gc`.
- `falsePositiveScenarios.blocked` should remain `0` for the included benign repeated "again" prompts.
- `loopDetectionBehavior.blockedAtStep` should show when a repeated loop is stopped.
- `costEstimationBoundaries` reports this package's dependency-free estimator, not exact provider tokenizer output.
