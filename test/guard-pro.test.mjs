import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GuardError } from '../dist/index.js';
import { GuardPro, getProGuard } from '../dist/pro.js';

class FakeRedis {
  status = 'wait';
  values = new Map();
  failEval = false;
  invalidEvalResult = false;
  deleted = [];

  on() {
    return this;
  }

  async connect() {
    this.status = 'ready';
  }

  async eval(_script, _keys, key, amount) {
    if (this.failEval) throw new Error('redis down');
    if (this.invalidEvalResult) return 'not-a-number';
    const next = Number(this.values.get(key) ?? '0') + Number(amount);
    this.values.set(key, String(next));
    return String(next);
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async del(key) {
    this.deleted.push(key);
    this.values.delete(key);
  }

  async quit() {
    this.status = 'end';
  }
}

test('GuardPro charges Redis atomically and blocks over budget', async () => {
  const redis = new FakeRedis();
  const guard = new GuardPro({
    redisUrl: 'redis://unit',
    redisClient: redis,
    budget: 0.05,
    windowSeconds: 60,
  });

  await guard.checkAndCharge('project-a', 0.02);
  await guard.checkAndCharge('project-a', 0.02);
  assert.equal(await guard.getSpend('project-a'), 0.04);

  await assert.rejects(() => guard.checkAndCharge('project-a', 0.02), GuardError);
  assert.equal(redis.status, 'ready');

  await guard.resetSpend('project-a');
  assert.equal(await guard.getSpend('project-a'), 0);
});

test('GuardPro falls back to local state when Redis fails', async () => {
  const redis = new FakeRedis();
  redis.failEval = true;
  const guard = new GuardPro({
    redisUrl: 'redis://unit-failure',
    redisClient: redis,
    budget: 0.03,
    windowSeconds: 60,
  });

  await guard.checkAndCharge('project-b', 0.02);
  assert.equal(await guard.getSpend('project-b'), 0.02);

  await assert.rejects(() => guard.checkAndCharge('project-b', 0.02), /exceeded budget/);
});

test('GuardPro rejects invalid charges before mutating spend', async () => {
  const redis = new FakeRedis();
  const guard = new GuardPro({
    redisUrl: 'redis://unit-invalid',
    redisClient: redis,
    budget: 1,
    windowSeconds: 60,
  });

  await assert.rejects(() => guard.checkAndCharge('', 0.01), /projectId must be a non-empty string/);
  await assert.rejects(() => guard.checkAndCharge('project-c', -0.01), /estimatedCost must be a finite non-negative number/);
  await assert.rejects(() => guard.checkAndCharge('project-c', Number.NaN), /estimatedCost must be a finite non-negative number/);
  assert.equal(await guard.getSpend('project-c'), 0);
});

test('GuardPro falls back when Redis returns an invalid total', async () => {
  const redis = new FakeRedis();
  redis.invalidEvalResult = true;
  const guard = new GuardPro({
    redisUrl: 'redis://unit-invalid-total',
    redisClient: redis,
    budget: 1,
    windowSeconds: 60,
  });

  await guard.checkAndCharge('project-d', 0.25);
  assert.equal(await guard.getSpend('project-d'), 0.25);
});

test('GuardPro factory creates guards', () => {
  assert.ok(getProGuard({ redisUrl: 'redis://unit', budget: 1 }) instanceof GuardPro);
});
