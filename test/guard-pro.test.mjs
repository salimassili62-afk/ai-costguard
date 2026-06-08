import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GuardError } from '../dist/index.js';
import { GuardPro, getProGuard, validateLicense } from '../dist/pro.js';

class FakeRedis {
  status = 'wait';
  values = new Map();
  failEval = false;
  deleted = [];

  on() {
    return this;
  }

  async connect() {
    this.status = 'ready';
  }

  async eval(_script, _keys, key, amount) {
    if (this.failEval) throw new Error('redis down');
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

test('GuardPro keeps license helpers as non-enforcing compatibility checks', () => {
  assert.equal(validateLicense('short'), false);
  assert.equal(validateLicense('aaaaaaaaaaaaaaaa'), true);
  assert.ok(getProGuard({ redisUrl: 'redis://unit', budget: 1, licenseKey: 'short' }) instanceof GuardPro);
  assert.ok(new GuardPro({ redisUrl: 'redis://unit', budget: 1, licenseKey: 'short' }) instanceof GuardPro);
});
