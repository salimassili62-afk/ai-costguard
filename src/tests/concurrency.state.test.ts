/**
 * CONCURRENCY AND STATE CORRECTNESS TESTS
 * Race conditions, parallel requests, persistence sync
 */

import { DetectionEngine } from '../core/DetectionEngine';
import { stateStore } from '../core/StateStore';
import { ProxyServer } from '../proxy';
import { AIExecutionFirewall } from '../wrapper/sdk';
import axios from 'axios';

describe('Concurrency and State Correctness Tests', () => {
  let engine: DetectionEngine;
  let proxy: ProxyServer;
  const PROXY_PORT = 3459;

  beforeAll(() => {
    proxy = new ProxyServer(PROXY_PORT);
    proxy.start();
  });

  afterAll(() => {
    proxy.stop();
  });

  beforeEach(() => {
    engine = DetectionEngine.getInstance();
    engine.clear();
  });

  afterEach(() => {
    engine.clear();
  });

  describe('Parallel Request Handling', () => {
    test('should handle 50 concurrent identical requests correctly', async () => {
      const prompt = 'concurrent test';

      // Fire 50 requests simultaneously
      const promises = Array.from({ length: 50 }, (_, i) =>
        axios.post(
          `http://localhost:${PROXY_PORT}/v1/chat/completions`,
          { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }] },
          { validateStatus: () => true }
        )
      );

      const responses = await Promise.all(promises);

      // All should complete
      expect(responses.every(r => r.status !== undefined)).toBe(true);

      // Check state
      const stats = engine.getStats(1);
      expect(stats.totalRequests).toBe(50);

      // Most should be blocked after loop detection kicks in
      expect(stats.blockedRequests).toBeGreaterThanOrEqual(47);
    });

    test('should handle concurrent different requests without cross-contamination', async () => {
      const promises = Array.from({ length: 20 }, (_, i) =>
        axios.post(
          `http://localhost:${PROXY_PORT}/v1/chat/completions`,
          { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: `unique ${i}` }] },
          { validateStatus: () => true }
        )
      );

      const responses = await Promise.all(promises);

      // All 20 unique prompts should be allowed (no duplicates)
      const allAllowed = responses.every(r => r.status === 200 || r.status === 403);
      expect(allAllowed).toBe(true);

      // State should reflect 20 requests
      const stats = engine.getStats(1);
      expect(stats.totalRequests).toBe(20);
      expect(stats.blockedRequests).toBe(0); // All unique
    });

    test('should handle mixed concurrent safe and dangerous requests', async () => {
      // 10 safe requests + 10 loop-triggering requests
      const safePromises = Array.from({ length: 10 }, (_, i) =>
        axios.post(
          `http://localhost:${PROXY_PORT}/v1/chat/completions`,
          { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: `safe ${i}` }] },
          { validateStatus: () => true }
        )
      );

      const loopPromises = Array.from({ length: 10 }, () =>
        axios.post(
          `http://localhost:${PROXY_PORT}/v1/chat/completions`,
          { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'loop trigger' }] },
          { validateStatus: () => true }
        )
      );

      const [safeResponses, loopResponses] = await Promise.all([
        Promise.all(safePromises),
        Promise.all(loopPromises),
      ]);

      // All should complete
      expect(safeResponses.every(r => r.status !== undefined)).toBe(true);
      expect(loopResponses.every(r => r.status !== undefined)).toBe(true);

      // Check state
      const stats = engine.getStats(1);
      expect(stats.totalRequests).toBe(20);
    });
  });

  describe('State Consistency Under Load', () => {
    test('stats should be consistent after 100 rapid requests', async () => {
      const requests = [];
      for (let i = 0; i < 100; i++) {
        requests.push({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: `load ${i % 10}` }], // 10 groups of duplicates
        });
      }

      // Fire all requests
      const promises = requests.map(req =>
        axios.post(
          `http://localhost:${PROXY_PORT}/v1/chat/completions`,
          req,
          { validateStatus: () => true }
        )
      );

      await Promise.all(promises);

      // Verify state is consistent
      const stats = engine.getStats(1);
      const blocked = engine.getBlocked(100);

      expect(stats.totalRequests).toBe(100);
      expect(blocked.length).toBe(stats.blockedRequests);

      // Verify cost calculations are correct
      const records = stateStore.getAllRecent(3600000);
      const calculatedTotalCost = records.reduce((sum, r) => sum + r.estimatedCost, 0);
      expect(stats.totalCost).toBe(calculatedTotalCost);
    });

    test('prompt hashes should be deterministic and consistent', async () => {
      const prompt = 'hash consistency test';

      // Calculate hash multiple times
      const hashes = [];
      for (let i = 0; i < 10; i++) {
        hashes.push(stateStore.generateHash(prompt));
      }

      // All hashes should be identical
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(1);

      // Should be 64 character hex string (SHA-256)
      const hash = hashes[0];
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Memory vs Persistence Sync', () => {
    test('state in memory should match persisted state', async () => {
      // Add records
      for (let i = 0; i < 5; i++) {
        engine.analyze({
          model: 'gpt-4',
          prompt: `sync test ${i}`,
          estimatedCost: 0.01,
        });
      }

      // Get memory stats
      const memoryStats = stateStore.getStats(1);

      // Get records directly from store
      const records = stateStore.getAllRecent(3600000);

      // Should match
      expect(memoryStats.totalRequests).toBe(records.length);

      // Verify specific fields
      const blockedFromRecords = records.filter(r => r.wasBlocked).length;
      expect(memoryStats.blockedRequests).toBe(blockedFromRecords);
    });

    test('recent records should be in correct time order', async () => {
      // Add records with small delays
      const timestamps: number[] = [];
      for (let i = 0; i < 5; i++) {
        engine.analyze({
          model: 'gpt-4',
          prompt: `order test ${i}`,
          estimatedCost: 0.01,
        });
        timestamps.push(Date.now());
        await new Promise(r => setTimeout(r, 10)); // Small delay
      }

      const records = stateStore.getAllRecent(3600000);

      // Should be sorted by timestamp descending (most recent first)
      for (let i = 0; i < records.length - 1; i++) {
        expect(records[i].timestamp).toBeGreaterThanOrEqual(records[i + 1].timestamp);
      }
    });
  });

  describe('Race Condition Prevention', () => {
    test('concurrent duplicate detections should be consistent', async () => {
      const prompt = 'race condition test';

      // First, prime the state
      engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 });

      // Then fire 10 concurrent duplicates
      const promises = Array.from({ length: 10 }, () =>
        Promise.resolve(
          engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 })
        )
      );

      const results = await Promise.all(promises);

      // All should see the same duplicate count
      const duplicateCounts = results.map(r => r.metadata.duplicateCount);
      const uniqueCounts = new Set(duplicateCounts);

      // Should be consistent (all see 1 duplicate since they run concurrently after first)
      expect(uniqueCounts.size).toBe(1);
    });

    test('state updates should be atomic', async () => {
      const prompt = 'atomic test';

      // Fire requests that will update same state
      const promises = Array.from({ length: 20 }, () =>
        axios.post(
          `http://localhost:${PROXY_PORT}/v1/chat/completions`,
          { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }] },
          { validateStatus: () => true }
        )
      );

      await Promise.all(promises);

      // Check state integrity
      const stats = engine.getStats(1);
      const records = stateStore.getAllRecent(3600000);

      // Should have exactly 20 records, no more no less
      expect(stats.totalRequests).toBe(20);
      expect(records.length).toBe(20);
    });
  });

  describe('SDK Concurrency', () => {
    test('SDK should handle concurrent calls safely', async () => {
      const sdk = new AIExecutionFirewall();

      const promises = Array.from({ length: 10 }, (_, i) =>
        sdk.call(
          () => Promise.resolve({ result: i }),
          { model: 'gpt-4', prompt: `sdk concurrent ${i}` }
        )
      );

      const results = await Promise.all(promises);

      // All should complete successfully
      expect(results.every(r => r.success === true)).toBe(true);
      expect(results.every(r => r.blocked === false)).toBe(true);

      // State should show 10 requests
      const stats = engine.getStats(1);
      expect(stats.totalRequests).toBe(10);
    });
  });

  describe('Cross-Interface State Race Conditions', () => {
    test('SDK and Proxy concurrent access should be safe', async () => {
      const sdk = new AIExecutionFirewall();
      const prompt = 'cross interface race';

      // Concurrent SDK and Proxy requests
      const sdkPromise = sdk.call(
        () => Promise.resolve({}),
        { model: 'gpt-4', prompt }
      );

      const proxyPromise = axios.post(
        `http://localhost:${PROXY_PORT}/v1/chat/completions`,
        { model: 'gpt-4', messages: [{ role: 'user', content: prompt }] },
        { validateStatus: () => true }
      );

      await Promise.all([sdkPromise, proxyPromise]);

      // State should be consistent
      const stats = engine.getStats(1);
      expect(stats.totalRequests).toBe(2);
    });
  });

  describe('Clear/Reset Operations', () => {
    test('clear should immediately reset all state', async () => {
      // Add some state
      for (let i = 0; i < 5; i++) {
        engine.analyze({ model: 'gpt-4', prompt: `clear ${i}`, estimatedCost: 0.01 });
      }

      // Verify state exists
      expect(engine.getStats(1).totalRequests).toBe(5);

      // Clear
      engine.clear();

      // Verify cleared
      const stats = engine.getStats(1);
      expect(stats.totalRequests).toBe(0);
      expect(stats.blockedRequests).toBe(0);
      expect(stats.totalCost).toBe(0);
    });

    test('reset should restore initial state', async () => {
      // Add state
      engine.analyze({ model: 'gpt-4', prompt: 'reset test', estimatedCost: 0.01 });

      // Reset
      engine.reset();

      // Should be clean
      expect(engine.getStats(1).totalRequests).toBe(0);
    });
  });
});
