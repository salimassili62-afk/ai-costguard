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

  assert.ok(report.sampleCount >= 20);
  assert.equal(typeof report.averageErrorPercent, 'number');
  assert.equal(typeof report.medianErrorPercent, 'number');
  assert.equal(typeof report.maxErrorPercent, 'number');
  assert.match(report.reference.note, /not to claim exact provider parity/);
  assert.match(report.markdownTable, /\| sample \| estimate \| proxy \| error \| error % \|/);
});
