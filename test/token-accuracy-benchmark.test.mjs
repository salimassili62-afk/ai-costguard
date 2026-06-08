import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('token accuracy benchmark emits error metrics', () => {
  const result = spawnSync(process.execPath, ['benchmarks/token-accuracy.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);

  assert.equal(report.sampleCount, 8);
  assert.equal(typeof report.averageErrorPercent, 'number');
  assert.equal(typeof report.medianErrorPercent, 'number');
  assert.equal(typeof report.maxErrorPercent, 'number');
  assert.match(report.reference.note, /not to claim exact tokenizer parity/);
});
