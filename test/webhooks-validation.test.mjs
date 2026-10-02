import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { sendCostGuardAlert } from '../dist/esm/core/alerts.js';
import { notifyBlockWebhooks } from '../dist/esm/core/webhooks.js';

test('sendCostGuardAlert does not call fetch when webhookUrl is empty/whitespace', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    throw new Error('should not fetch');
  });
  try {
    await sendCostGuardAlert({ webhookUrl: '' }, {
      event: 'blocked',
      reason: 'budget_exceeded',
      severity: 'critical',
      estimatedCostUsd: 1,
      budgetLimitUsd: 10,
      budgetUsedUsd: 10,
      timestamp: new Date().toISOString(),
    });
    await sendCostGuardAlert({ webhookUrl: '   ' }, {
      event: 'blocked',
      reason: 'budget_exceeded',
      severity: 'critical',
      estimatedCostUsd: 1,
      budgetLimitUsd: 10,
      budgetUsedUsd: 10,
      timestamp: new Date().toISOString(),
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
  }
});

test('rejects non-HTTPS remote webhook URL (http://example.com)', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok'));
  try {
    await sendCostGuardAlert({ webhookUrl: 'http://example.com/hook' }, {
      event: 'blocked',
      reason: 'budget_exceeded',
      severity: 'critical',
      estimatedCostUsd: 0.01,
      budgetLimitUsd: 5,
      budgetUsedUsd: 5.01,
      timestamp: new Date().toISOString(),
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
  }
});

test('accepts HTTPS webhook URL', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));
  try {
    await sendCostGuardAlert({ webhookUrl: 'https://hooks.example.com/webhook' }, {
      event: 'blocked',
      reason: 'budget_exceeded',
      severity: 'critical',
      estimatedCostUsd: 0.01,
      budgetLimitUsd: 5,
      budgetUsedUsd: 5.01,
      timestamp: new Date().toISOString(),
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    fetchMock.mock.restore();
  }
});

test('accepts http://127.0.0.1 for local dev', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));
  try {
    await sendCostGuardAlert({ webhookUrl: 'http://127.0.0.1:8080/hook' }, {
      event: 'blocked',
      reason: 'budget_exceeded',
      severity: 'critical',
      estimatedCostUsd: 0.001,
      budgetLimitUsd: 1,
      budgetUsedUsd: 1.001,
      timestamp: new Date().toISOString(),
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    fetchMock.mock.restore();
  }
});

test('accepts http://localhost for local dev', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));
  try {
    await sendCostGuardAlert({ webhookUrl: 'http://localhost:9000/hook' }, {
      event: 'blocked',
      reason: 'budget_exceeded',
      severity: 'critical',
      estimatedCostUsd: 0.001,
      budgetLimitUsd: 1,
      budgetUsedUsd: 1.001,
      timestamp: new Date().toISOString(),
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    fetchMock.mock.restore();
  }
});

test('accepts http://[::1] for IPv6 loopback', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));
  try {
    await sendCostGuardAlert({ webhookUrl: 'http://[::1]:8000/hook' }, {
      event: 'blocked',
      reason: 'budget_exceeded',
      severity: 'critical',
      estimatedCostUsd: 0.001,
      budgetLimitUsd: 1,
      budgetUsedUsd: 1.001,
      timestamp: new Date().toISOString(),
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    fetchMock.mock.restore();
  }
});

test('rejects malformed webhook URL (not-a-url)', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok'));
  try {
    await sendCostGuardAlert({ webhookUrl: 'not-a-url' }, {
      event: 'blocked',
      reason: 'budget_exceeded',
      severity: 'critical',
      estimatedCostUsd: 0.01,
      budgetLimitUsd: 5,
      budgetUsedUsd: 5.01,
      timestamp: new Date().toISOString(),
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
  }
});

test('validation failure cannot turn into an application crash', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('network error'); });
  try {
    await assert.doesNotReject(async () => {
      await sendCostGuardAlert({ webhookUrl: 'http://bad.example/hook' }, {
        event: 'blocked',
        reason: 'budget_exceeded',
        severity: 'critical',
        estimatedCostUsd: 0.01,
        budgetLimitUsd: 5,
        budgetUsedUsd: 5.01,
        timestamp: new Date().toISOString(),
      });
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
  }
});

test('notifyBlockWebhooks rejects HTTP remote and does not fetch', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok'));
  try {
    const context = { model: 'gpt-4o-mini', estimatedCost: 0.01 };
    await notifyBlockWebhooks({ slack: 'http://remote.example/slack' }, {
      reason: 'BUDGET_EXCEEDED',
      context,
    });
    await notifyBlockWebhooks({ discord: 'not-a-url' }, {
      reason: 'BUDGET_EXCEEDED',
      context,
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
  }
});

test('notifyBlockWebhooks accepts HTTPS slack webhook', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));
  try {
    await notifyBlockWebhooks({ slack: 'https://hooks.slack.com/services/XXX/YYY/ZZZ' }, {
      reason: 'BUDGET_EXCEEDED',
      context: {
        model: 'gpt-4o-mini',
        estimatedCost: 0.01,
      },
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    fetchMock.mock.restore();
  }
});
