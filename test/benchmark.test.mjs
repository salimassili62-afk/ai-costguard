import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('benchmark script emits sane JSON', () => {
  const result = spawnSync(process.execPath, ['benchmarks/run.mjs', '--iterations', '100'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);

  assert.equal(report.iterations, 100);
  assert.equal(typeof report.runtimeOverhead.addedPerCallMs, 'number');
  assert.equal(report.falsePositiveScenarios.blocked, 0);
  assert.equal(report.loopDetectionBehavior.code, 'LOOP_DETECTED');
  assert.equal(report.costEstimationBoundaries.doesNotClaimProviderExactness, true);
});
