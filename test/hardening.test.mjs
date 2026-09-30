import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GuardError, middleware } from '../dist/esm/core/GuardFree.js';
import { GuardCore } from '../dist/esm/core/GuardCore.js';
import { estimateRequestTokens } from '../dist/esm/core/tokenizer.js';

const request = (text) => ({ model: 'gpt-4o', messages: [{ role: 'user', content: text }], max_tokens: 200 });

/** A request that will cost more than any budget used in the scope tests. */
const expensive = (sessionId) => ({ model: 'gpt-4o', prompt: 'work', max_tokens: 500, sessionId });

const costOf = (body) => new GuardCore({ budget: 10 }).extractContext([body]).estimatedCost;

const backdateScopes = (core, ms) => {
  const backdated = Date.now() - ms;
  for (const scope of Object.values(core.getState().scopes ?? {})) {
    scope.lastRequestTime = backdated;
  }
};

const assertBudgetBlocked = (fn, message) =>
  assert.throws(fn, (error) => error instanceof GuardError && error.code === 'BUDGET_EXCEEDED', message);

test('the tokenizer reserves output for every candidate of every batched prompt', () => {
  const estimate = estimateRequestTokens({
    model: 'gpt-4o',
    prompt: ['first prompt', 'second prompt', 'third prompt'],
    n: 2,
    max_tokens: 100,
  });

  assert.equal(estimate.promptCount, 3);
  assert.equal(estimate.candidateCount, 2);
  assert.equal(estimate.outputTokensPerCandidate, 100);
  assert.equal(estimate.outputTokens, 600, 'output is maxTokens * candidates * prompts');
});

test('the tokenizer leaves single-prompt and single-candidate requests unchanged', () => {
  const single = estimateRequestTokens({ model: 'gpt-4o', prompt: 'one prompt', max_tokens: 100 });
  assert.equal(single.promptCount, 1);
  assert.equal(single.candidateCount, 1);
  assert.equal(single.outputTokens, 100);

  const chat = estimateRequestTokens({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], n: 3, max_tokens: 50 });
  assert.equal(chat.promptCount, 1, 'a messages array is one conversation, never a batch');
  assert.equal(chat.outputTokens, 150);

  const noMax = estimateRequestTokens({ model: 'gpt-4o', prompt: 'one prompt' });
  assert.equal(noMax.outputTokens, undefined, 'an absent max_tokens stays absent rather than becoming 0');
});

test('GuardCore charges batched candidates instead of a single completion', () => {
  const single = costOf({ model: 'gpt-4o', prompt: 'first prompt', n: 1, max_tokens: 100 });
  const batched = costOf({ model: 'gpt-4o', prompt: ['first prompt', 'second prompt', 'third prompt'], n: 2, max_tokens: 100 });

  assert.ok(
    batched > single * 5,
    `a 3-prompt, 2-candidate request must cost far more than one completion (${batched} vs ${single})`
  );
});

test('a batched request is blocked by a budget that would allow a single completion', () => {
  const single = costOf({ model: 'gpt-4o', prompt: 'measure the batch', max_tokens: 100 });
  const batched = costOf({ model: 'gpt-4o', prompt: ['a', 'b', 'c'], n: 2, max_tokens: 100 });
  const budget = (single + batched) / 2;

  const cheap = new GuardCore({ budget });
  assert.doesNotThrow(() => cheap.check(cheap.extractContext([{ model: 'gpt-4o', prompt: 'measure the batch', max_tokens: 100 }])));

  const pricey = new GuardCore({ budget });
  assertBudgetBlocked(() => pricey.check(pricey.extractContext([{ model: 'gpt-4o', prompt: ['a', 'b', 'c'], n: 2, max_tokens: 100 }])));
});

test('middleware checkRequest cannot be under-reported by the caller', () => {
  // check() trusts the caller's context, so a caller that reports $0 reserves $0 and its budget never
  // moves. checkRequest() costs the raw request with the guard's own tokenizer and pricing table.
  const body = request('a long prompt that certainly costs something measurable');

  const honest = {};
  middleware({ budget: 10 })(honest, {}, () => {});
  honest.localSafety.checkRequest(body);
  assert.equal(honest.localSafety.state.reservedCost, costOf(body), 'the guard costs the request itself');

  const liar = {};
  middleware({ budget: 10 })(liar, {}, () => {});
  liar.localSafety.check({ ...new GuardCore({ budget: 10 }).extractContext([body]), estimatedCost: 0 });
  assert.equal(liar.localSafety.state.reservedCost, 0, 'a caller reporting $0 is trusted, which is the hazard');
});

test('middleware checkRequest enforces the budget', () => {
  // The demonstration above only shows the reservation. This shows the money stops: a budget that
  // covers one of these requests does not cover the next.
  const budget = costOf(request('the first question about billing'));
  const req = {};
  middleware({ budget })(req, {}, () => {});

  assert.doesNotThrow(() => req.localSafety.checkRequest(request('the first question about billing')));
  assertBudgetBlocked(() => req.localSafety.checkRequest(request('an entirely different question regarding invoices')));
});

test('middleware checkRequest costs a request exactly as a direct guard check does', () => {
  const body = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello there' }], max_tokens: 500 };
  const req = {};
  middleware({ budget: 10 })(req, {}, () => {});

  req.localSafety.checkRequest(body);
  const viaMiddleware = req.localSafety.state.reservedCost;

  const direct = new GuardCore({ budget: 10 });
  direct.check(direct.extractContext([body]));

  assert.equal(viaMiddleware, direct.getState().reservedCost);
});

test('a blocked check refreshes its scope timestamp', () => {
  const core = new GuardCore({ budget: 0.000_001, scopeIdleTtlMs: 60_000 });
  const call = () => core.extractContext([expensive('s1')]);
  const scopeKey = call().scopeKey;

  assertBudgetBlocked(() => core.check(call()));
  const first = core.getState().scopes[scopeKey].lastRequestTime;

  backdateScopes(core, 60_000);
  assertBudgetBlocked(() => core.check(call()));

  const refreshed = core.getState().scopes[scopeKey].lastRequestTime;
  assert.ok(refreshed >= first, 'a blocked request proves the scope is still in use');
  assert.equal(core.getState().scopes[scopeKey].reservedCost, 0);
});

test('a scope that keeps getting blocked is not reclaimed as idle', () => {
  // Reclaiming a blocked-only scope returned its budget to a client that is still being denied
  // requests, and let a denied session keep spending against a scope the guard had forgotten.
  const core = new GuardCore({ budget: 0.000_001, maxScopes: 2, scopeIdleTtlMs: 60_000 });
  const call = (sessionId) => core.extractContext([expensive(sessionId)]);
  const scopeKey = call('s1').scopeKey;

  assertBudgetBlocked(() => core.check(call('s1')));
  assertBudgetBlocked(() => core.check(call('s3')));

  // Both scopes now look idle. Only the next denied request proves s1 is still in use.
  backdateScopes(core, 60_000);
  assertBudgetBlocked(() => core.check(call('s1')));
  assertBudgetBlocked(() => core.check(call('s4')));

  const state = core.getState();
  assert.ok(state.scopes[scopeKey], 'a scope still being denied requests must keep its budget');
  assert.equal(state.reclaimedScopeCount, 1, 'only the genuinely idle scope is reclaimed');
});

test('reclaiming a scope grants a fresh per-scope budget, and the aggregate is not a process-wide cap', () => {
  // This pins the spend bound that the reclaimIdleScopes doc comment and the README now state, so
  // neither can drift back into claiming a guarantee the code does not provide. The previous comment
  // asserted reclamation could only ever grant "the TTL window's worth of extra spend"; the honest
  // statement is that `budget` is per-scope and the process-wide counters are reporting only, so a
  // caller that keeps introducing new session ids can spend more than `budget` in total.
  const cost = costOf(expensive('probe'));
  const budget = cost * 2;
  const core = new GuardCore({ budget, maxScopes: 2, scopeIdleTtlMs: 60_000 });

  const call = (sessionId) => core.extractContext([expensive(sessionId)]);

  // Each new session spends up to its own budget. Two sessions exhaust the map.
  core.check(call('s1'));
  core.check(call('s2'));
  const spentByS1 = core.getState().scopes[call('s1').scopeKey].totalCost;
  assert.ok(
    Math.abs(spentByS1 - cost) < 1e-9,
    `s1 should have spent one call's cost, got ${spentByS1} vs ${cost}`
  );

  // A third session forces a sweep. Both earlier sessions were backdated, so both are dropped and
  // their budgets forgotten; the map is then free to admit s3.
  backdateScopes(core, 60_000);
  core.check(call('s3'));
  const afterSweep = core.getState();
  assert.equal(afterSweep.reclaimedScopeCount, 2, 'both idle session scopes are reclaimed');
  assert.equal(afterSweep.scopes[call('s1').scopeKey], undefined, 'the reclaimed scope is forgotten');

  // The aggregate kept counting the reclaimed spend; it is a report, not a gate.
  assert.ok(
    afterSweep.attemptedCost > budget,
    'the process-wide counter still records every dollar, including the reclaimed scope'
  );

  // That counter is never consulted to block, so returning to the reclaimed key is allowed again.
  // This is the documented cost of `scopeIdleTtlMs`, asserted so nobody later reads the aggregate as
  // a backstop, and so a future change that adds a process-wide cap has to update this test and the
  // documentation together rather than silently diverging from them.
  assert.doesNotThrow(() => core.check(call('s1')), 'a reclaimed session starts a fresh budget');

  // A durable identity is never reclaimed, so it keeps enforcing across the same window.
  const durable = new GuardCore({ budget, maxScopes: 1, scopeIdleTtlMs: 60_000 });
  const projectCall = () => durable.extractContext([{ ...expensive('x'), sessionId: undefined, projectId: 'p1' }]);
  durable.check(projectCall());
  durable.check(projectCall());
  assertBudgetBlocked(() => durable.check(projectCall()), 'a projectId scope keeps accumulating spend');
});

test('prompts that merely lead with "again" are not treated as retries', () => {
  const core = new GuardCore({ budget: 1, retryThreshold: 2, loopSimilarityThreshold: 0.9 });

  for (const prompt of [
    'again compare the two product options',
    'again summarize the second option with different tradeoffs',
    'again write a new title for the launch note',
    'again draft a reply to the customer complaint',
  ]) {
    assert.doesNotThrow(
      () => core.check(core.extractContext([request(prompt)])),
      `"${prompt}" continues a conversation, it does not retry a call`
    );
  }
});

test('prose that discusses retries is not treated as a retry storm', () => {
  const core = new GuardCore({ budget: 1, retryThreshold: 2 });

  for (const prompt of [
    'Write unit tests for the retry wrapper. The error class is called TransientError.',
    'Summarize the changelog. If you see an error in the data, repeat the step with the next file.',
    'Explain what an error is and why a failed request should not be repeated automatically.',
  ]) {
    assert.doesNotThrow(
      () => core.check(core.extractContext([request(prompt)])),
      `"${prompt}" is documentation, not a retry`
    );
  }
});

test('genuine retries are still detected', () => {
  for (const prompt of [
    'Error: 429 rate limit exceeded. Retrying.',
    'retry failed retrieval after timeout for customer A',
    'again after 429 error for customer B',
    'repeat after failed vector search for customer C',
    'the request failed with 503, trying again',
  ]) {
    const retryThreshold = 2;
    const core = new GuardCore({ budget: 1, retryThreshold });
    const attempt = () => core.check(core.extractContext([request(prompt)]));

    assert.doesNotThrow(attempt, 'the first attempt is not a storm');

    let blocked = false;
    for (let call = 0; call <= retryThreshold; call += 1) {
      try {
        attempt();
      } catch (error) {
        assert.ok(error instanceof GuardError, `"${prompt}" threw a non-GuardError`);
        assert.equal(error.code, 'RETRY_STORM_DETECTED', `"${prompt}" must count as a retry`);
        blocked = true;
        break;
      }
    }

    assert.ok(blocked, `"${prompt}" was never treated as a retry`);
  }
});

test('a block reason identifies a scope without disclosing it', () => {
  const core = new GuardCore({ budget: 0.000_001 });
  const context = core.extractContext([{ ...request('disclose nothing'), userId: 'alice@example.com', sessionId: 'tenant-42/session-9' }]);

  let error;
  try {
    core.check(context);
  } catch (thrown) {
    error = thrown;
  }

  assert.ok(error instanceof GuardError, 'the request must be blocked');
  assert.match(error.message, /scope#[0-9a-f]{8}/u, 'the reason should point at the scope with a stable pseudonym');
  assert.doesNotMatch(error.message, /alice@example\.com/u);
  assert.doesNotMatch(error.message, /tenant-42/u);
  assert.doesNotMatch(error.message, /session-9/u);

  // The identity stays available for the caller's own handling.
  assert.equal(error.context.scope.userId, 'alice@example.com');
});

test('the scope pseudonym is stable within a process and does not encode the scope', () => {
  const reasonFor = (userId) => {
    const core = new GuardCore({ budget: 0.000_001 });
    try {
      core.check(core.extractContext([{ ...request('stable'), userId }]));
    } catch (error) {
      return error.message;
    }
    throw new assert.AssertionError({ message: 'expected a block' });
  };

  const first = reasonFor('carol@example.com');
  assert.equal(reasonFor('carol@example.com'), first, 'one scope maps to one pseudonym in a process');
  assert.doesNotMatch(first, /carol/u, 'the pseudonym must not encode the scope');
  assert.match(first, /scope#[0-9a-f]{8}/u);
});

test('the default scope produces a reason with no scope pseudonym', () => {
  const core = new GuardCore({ budget: 0.000_001 });

  assertBudgetBlocked(() => core.check(core.extractContext([request('no scope')])));
  try {
    core.check(core.extractContext([request('no scope')]));
  } catch (error) {
    assert.doesNotMatch(error.message, /scope#/u, 'the unscoped default must not claim a scope');
  }
});

test('event logging keeps writing after its directory is removed underneath it', async () => {
  // A deploy, a logrotate, or a tmpfs cleanup can remove the directory between writes. A cached
  // directory handle must not turn that into permanent, silent loss of events.
  const dir = await mkdtemp(path.join(tmpdir(), 'aicg-log-'));
  const logPath = path.join(dir, 'nested', 'events.jsonl');
  const logBlock = (text) => {
    const core = new GuardCore({ budget: 0.000_001, eventLogPath: logPath });
    assertBudgetBlocked(() => core.check(core.extractContext([request(text)])));
  };
  const blocks = async () => {
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    return lines.map((line) => JSON.parse(line)).filter((record) => record.type === 'block').length;
  };

  try {
    for (let event = 0; event < 3; event += 1) logBlock(`event ${event}`);
    assert.equal(await blocks(), 3, 'nested directories are created on demand');

    await rm(path.dirname(logPath), { recursive: true, force: true });

    for (let event = 3; event < 6; event += 1) logBlock(`event ${event}`);
    assert.equal(await blocks(), 3, 'the file starts over when its directory was removed');
    assert.equal((await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean).length, 6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the event log never records a prompt or an identity', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aicg-log-redact-'));
  const logPath = path.join(dir, 'events.jsonl');

  try {
    const core = new GuardCore({ budget: 0.000_001, eventLogPath: logPath });
    const body = { ...request('my password is hunter2-secret'), userId: 'dave@example.com' };
    assertBudgetBlocked(() => core.check(core.extractContext([body])));

    const records = (await readFile(logPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    assert.ok(records.length >= 1);
    for (const record of records) {
      assert.doesNotMatch(JSON.stringify(record), /hunter2-secret/u, 'a prompt must never reach the log');
      assert.doesNotMatch(JSON.stringify(record), /dave@example\.com/u, 'an identity must never reach the log');
      assert.match(record.scopeKey, /^scope#[0-9a-f]{8}$/u, 'the log identifies a scope by pseudonym');
    }
    const block = records.find((record) => record.type === 'block');
    assert.match(block.reason, new RegExp(`for ${block.scopeKey}:`, 'u'), 'the reason and the log agree on the label');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
