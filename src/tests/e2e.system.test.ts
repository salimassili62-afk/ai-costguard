/**
 * END-TO-END SYSTEM TESTS
 * Full flow: SDK → DetectionEngine → Logger → State → Proxy → CLI
 * Validates shared state consistency across all layers
 */

import { AIExecutionFirewall } from '../wrapper/sdk';
import { ProxyServer } from '../proxy';
import { detectionEngine } from '../core/DetectionEngine';
import { stateStore } from '../core/StateStore';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('E2E System Tests - Full Integration', () => {
  let proxy: ProxyServer;
  let sdk: AIExecutionFirewall;
  const PROXY_PORT = 3457;

  beforeAll(() => {
    proxy = new ProxyServer(PROXY_PORT);
    proxy.start();
    sdk = new AIExecutionFirewall();
  });

  afterAll(() => {
    proxy.stop();
    detectionEngine.clear();
  });

  beforeEach(() => {
    detectionEngine.clear();
  });

  describe('SDK → DetectionEngine → State Consistency', () => {
    test('SDK call should update DetectionEngine state', async () => {
      // Use SDK to make a call
      const mockApiCall = jest.fn().mockResolvedValue({ content: 'response' });

      await sdk.call(mockApiCall, {
        model: 'gpt-4',
        prompt: 'sdk state test',
      });

      // Check DetectionEngine sees the request
      const stats = detectionEngine.getStats(1);
      expect(stats.totalRequests).toBe(1);

      // Check stateStore has the record
      const allRecent = stateStore.getAllRecent(3600000);
      expect(allRecent.length).toBe(1);
      expect(allRecent[0].prompt).toBe('sdk state test');
    });

    test('SDK blocked call should be tracked in state', async () => {
      // First call
      await sdk.call(
        () => Promise.resolve({}),
        { model: 'gpt-4', prompt: 'block test' }
      );

      // Second call - duplicate warning
      const result = await sdk.call(
        () => Promise.resolve({}),
        { model: 'gpt-4', prompt: 'block test' }
      );

      // Third call - should trigger higher warning
      const result3 = await sdk.call(
        () => Promise.resolve({}),
        { model: 'gpt-4', prompt: 'block test' }
      );

      // Check state has all 3 requests
      const stats = detectionEngine.getStats(1);
      expect(stats.totalRequests).toBe(3);
    });
  });

  describe('Proxy → DetectionEngine → State Consistency', () => {
    test('proxy request should be visible in DetectionEngine', async () => {
      await axios.post(
        `http://localhost:${PROXY_PORT}/v1/chat/completions`,
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'proxy state test' }],
        },
        { validateStatus: () => true }
      );

      const stats = detectionEngine.getStats(1);
      expect(stats.totalRequests).toBe(1);
    });

    test('proxy blocked request should increment blocked count', async () => {
      const prompt = 'proxy block consistency';

      // Three requests to trigger block
      await axios.post(
        `http://localhost:${PROXY_PORT}/v1/chat/completions`,
        { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }] },
        { validateStatus: () => true }
      );

      await axios.post(
        `http://localhost:${PROXY_PORT}/v1/chat/completions`,
        { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }] },
        { validateStatus: () => true }
      );

      const blockedResponse = await axios.post(
        `http://localhost:${PROXY_PORT}/v1/chat/completions`,
        { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }] },
        { validateStatus: () => true }
      );

      expect(blockedResponse.status).toBe(403);

      const stats = detectionEngine.getStats(1);
      expect(stats.totalRequests).toBe(3);
      expect(stats.blockedRequests).toBe(1);
      expect(stats.preventedCost).toBeGreaterThan(0);
    });
  });

  describe('CLI → DetectionEngine → State Consistency', () => {
    test('CLI check command should record to DetectionEngine', async () => {
      await execAsync('node dist/cli/index.js check "cli state test" --model gpt-4');

      const stats = detectionEngine.getStats(1);
      expect(stats.totalRequests).toBe(1);
    });

    test('CLI report should show DetectionEngine stats', async () => {
      // Create state through SDK
      await sdk.call(
        () => Promise.resolve({}),
        { model: 'gpt-4', prompt: 'cli report test' }
      );

      // CLI report should see it
      const { stdout } = await execAsync('node dist/cli/index.js report');

      expect(stdout).toContain('Total Requests: 1');
    });
  });

  describe('Cross-Interface State Sharing', () => {
    test('SDK request should be detected as duplicate by Proxy', async () => {
      const prompt = 'cross interface test';

      // Make request through SDK
      await sdk.call(
        () => Promise.resolve({}),
        { model: 'gpt-4', prompt }
      );

      // Same request through Proxy should detect duplicate
      const proxyResponse = await axios.post(
        `http://localhost:${PROXY_PORT}/v1/chat/completions`,
        { model: 'gpt-4', messages: [{ role: 'user', content: prompt }] },
        { validateStatus: () => true }
      );

      // Should detect duplicate (either blocked or warned)
      expect([200, 403]).toContain(proxyResponse.status);

      const stats = detectionEngine.getStats(1);
      expect(stats.totalRequests).toBe(2);
    });

    test('CLI request should be detected as duplicate by SDK', async () => {
      const prompt = 'cli to sdk test';

      // Make request through CLI
      await execAsync(`node dist/cli/index.js check "${prompt}" --model gpt-4`);

      // Same request through SDK
      const result = await sdk.call(
        () => Promise.resolve({}),
        { model: 'gpt-4', prompt }
      );

      // Should detect duplicate or warning state
      expect(result.dangerScore).toBeGreaterThan(0);

      const stats = detectionEngine.getStats(1);
      expect(stats.totalRequests).toBe(2);
    });

    test('all three interfaces share state correctly', async () => {
      const prompt = 'three way test';

      // Request 1: SDK
      await sdk.call(
        () => Promise.resolve({}),
        { model: 'gpt-4', prompt: `${prompt} 1` }
      );

      // Request 2: Proxy
      await axios.post(
        `http://localhost:${PROXY_PORT}/v1/chat/completions`,
        { model: 'gpt-4', messages: [{ role: 'user', content: `${prompt} 2` }] },
        { validateStatus: () => true }
      );

      // Request 3: CLI
      await execAsync(`node dist/cli/index.js check "${prompt} 3" --model gpt-4`);

      // All should be tracked
      const stats = detectionEngine.getStats(1);
      expect(stats.totalRequests).toBe(3);
      expect(stats.blockedRequests).toBe(0);
    });
  });

  describe('Full Request Lifecycle', () => {
    test('complete lifecycle: safe → duplicate → loop detection', async () => {
      const prompt = 'lifecycle test';

      // Phase 1: Safe request
      const r1 = await sdk.call(
        () => Promise.resolve({ result: 'success' }),
        { model: 'gpt-4', prompt }
      );
      expect(r1.success).toBe(true);
      expect(r1.blocked).toBe(false);
      expect(r1.dangerScore).toBe(0);

      // Phase 2: Duplicate (warning)
      const r2 = await sdk.call(
        () => Promise.resolve({ result: 'success' }),
        { model: 'gpt-4', prompt }
      );
      expect(r2.dangerScore).toBeGreaterThan(0);
      expect(r2.dangerScore).toBeLessThan(90); // Not kill switch yet

      // Phase 3: Loop detection (kill switch)
      const r3 = await sdk.call(
        () => Promise.resolve({ result: 'success' }),
        { model: 'gpt-4', prompt }
      );
      expect(r3.blocked).toBe(true);
      expect(r3.killSwitchTriggered).toBe(true);
      expect(r3.dangerScore).toBe(93);

      // Verify state
      const stats = detectionEngine.getStats(1);
      expect(stats.totalRequests).toBe(3);
      expect(stats.blockedRequests).toBe(1);
      expect(stats.warnedRequests).toBe(2);
    });
  });

  describe('State Persistence Across Operations', () => {
    test('state persists between different operation types', async () => {
      // Mix operations
      await sdk.call(() => Promise.resolve({}), { model: 'gpt-4', prompt: 'op1' });
      await execAsync('node dist/cli/index.js check "op2" --model gpt-4');
      await axios.post(
        `http://localhost:${PROXY_PORT}/v1/chat/completions`,
        { model: 'gpt-4', messages: [{ role: 'user', content: 'op3' }] },
        { validateStatus: () => true }
      );

      // Check consistent state
      const engineStats = detectionEngine.getStats(1);
      const storeStats = stateStore.getStats(1);

      expect(engineStats.totalRequests).toBe(3);
      expect(storeStats.totalRequests).toBe(3);
    });
  });

  describe('Error State Consistency', () => {
    test('blocked state is consistent across all queries', async () => {
      const prompt = 'error consistency';

      // Trigger block through loop
      await sdk.call(() => Promise.resolve({}), { model: 'gpt-4', prompt });
      await sdk.call(() => Promise.resolve({}), { model: 'gpt-4', prompt });
      const blocked = await sdk.call(() => Promise.resolve({}), { model: 'gpt-4', prompt });

      expect(blocked.blocked).toBe(true);

      // CLI should see the blocked request
      const { stdout } = await execAsync('node dist/cli/index.js blocked');
      expect(stdout).toContain(prompt);

      // DetectionEngine should report it
      const blockedList = detectionEngine.getBlocked(10);
      expect(blockedList.length).toBe(1);
      expect(blockedList[0].prompt).toBe(prompt);
    });
  });
});
