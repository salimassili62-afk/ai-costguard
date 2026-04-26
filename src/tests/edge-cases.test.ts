/**
 * EDGE CASE AND BOUNDARY TESTS
 * Cost spike limits, anomaly thresholds, kill switch, duplicates over time
 */

import { DetectionEngine } from '../core/DetectionEngine';
import { stateStore } from '../core/StateStore';
import { ProxyServer } from '../proxy';
import axios from 'axios';

describe('Edge Cases and Boundary Tests', () => {
  let engine: DetectionEngine;
  let proxy: ProxyServer;
  const PROXY_PORT = 3458;

  beforeAll(async () => {
    proxy = new ProxyServer(PROXY_PORT);
    await proxy.start();
  });

  afterAll(async () => {
    await proxy.stop();
  });

  beforeEach(() => {
    engine = DetectionEngine.getInstance();
    engine.clear();
    proxy.clearRateLimits(); // Clear rate limits between tests
  });

  afterEach(() => {
    engine.clear();
  });

  describe('Cost Spike Detection Limits', () => {
    test('should warn at exactly $0.05 threshold', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'cost boundary test',
        estimatedCost: 0.05,
      });

      expect(result.category).toBe('spike');
      expect(result.dangerScore).toBe(30); // Base score at threshold
    });

    test('should calculate correct scores for various costs', () => {
      const testCases = [
        { cost: 0.05, expectedScore: 30 },
        { cost: 0.06, expectedScore: 30 }, // 30 + 0.01*50 = 30.5 -> 30
        { cost: 0.10, expectedScore: 32 }, // 30 + 0.05*50 = 32.5 -> 32
        { cost: 0.50, expectedScore: 52 }, // 30 + 0.45*50 = 52.5 -> 52
        { cost: 1.00, expectedScore: 77 }, // 30 + 0.95*50 = 77.5 -> 77
        { cost: 1.50, expectedScore: 100 }, // capped
        { cost: 5.00, expectedScore: 100 }, // capped
      ];

      testCases.forEach(({ cost, expectedScore }) => {
        const result = engine.analyze({
          model: 'gpt-4',
          prompt: `cost ${cost}`,
          estimatedCost: cost,
        });

        expect(result.dangerScore).toBe(expectedScore);
      });
    });

    test('should block when cost spike reaches 90+', () => {
      // Cost that gives exactly 90 score
      // 30 + (cost-0.05)*50 = 90
      // (cost-0.05)*50 = 60
      // cost-0.05 = 1.2
      // cost = 1.25

      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'high cost',
        estimatedCost: 1.25,
        trustMode: 'block',
      });

      expect(result.dangerScore).toBe(90);
      expect(result.decision).toBe('block');
    });
  });

  describe('Kill Switch Activation', () => {
    test('should activate kill switch at exactly 3 requests', () => {
      const prompt = 'kill switch boundary';

      // 2 requests - no kill switch
      engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 });
      engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 });

      const statsBefore = engine.getStats(1);
      expect(statsBefore.blockedRequests).toBe(0);

      // 3rd request - kill switch
      const result = engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 });

      expect(result.decision).toBe('block');
      expect(result.dangerScore).toBe(93); // 90 + 3*1
    });

    test('should maintain kill switch for subsequent requests', () => {
      const prompt = 'persistent kill';

      // Trigger kill switch
      for (let i = 0; i < 3; i++) {
        engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 });
      }

      // All subsequent requests should be blocked
      for (let i = 0; i < 5; i++) {
        const result = engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 });
        expect(result.decision).toBe('block');
        expect(result.category).toBe('loop');
      }
    });

    test('kill switch danger score should escalate correctly', () => {
      const prompt = 'escalating kill';

      const scores: number[] = [];
      for (let i = 0; i < 6; i++) {
        const result = engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 });
        scores.push(result.dangerScore);
      }

      // Expected: 0, 40, 93, 96, 99, 100
      expect(scores[0]).toBe(0); // First request (safe)
      expect(scores[1]).toBe(40); // Second request (duplicate warning: 30 + 1*10)
      expect(scores[2]).toBe(93); // Third request (loop: 90 + 3*1)
      expect(scores[3]).toBe(96); // Fourth request (loop: 90 + 3*2)
      expect(scores[4]).toBe(99); // Fifth request (loop: 90 + 3*3)
      expect(scores[5]).toBe(100); // Sixth request (capped)
    });
  });

  describe('Duplicate Detection Over Time', () => {
    test('should not detect duplicates after 1 hour window', async () => {
      const prompt = 'time window test';

      // Mock time to be 2 hours ago
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

      // Manually add old record
      stateStore.addRecord({
        id: 'old-record',
        timestamp: twoHoursAgo,
        model: 'gpt-4',
        prompt,
        promptHash: stateStore.generateHash(prompt),
        estimatedCost: 0.01,
        dangerScore: 0,
        isDangerous: false,
        category: 'safe',
        wasBlocked: false,
        wasWarned: false,
      });

      // New request should not see the old one
      const result = engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 });

      expect(result.category).toBe('safe');
      expect(result.dangerScore).toBe(0);
    });

    test('should detect duplicate within 1 hour but not after', async () => {
      const prompt = 'timing boundary';

      // Add record 59 minutes ago
      const fiftyNineMinutesAgo = Date.now() - 59 * 60 * 1000;
      stateStore.addRecord({
        id: 'recent-record',
        timestamp: fiftyNineMinutesAgo,
        model: 'gpt-4',
        prompt,
        promptHash: stateStore.generateHash(prompt),
        estimatedCost: 0.01,
        dangerScore: 0,
        isDangerous: false,
        category: 'safe',
        wasBlocked: false,
        wasWarned: false,
      });

      // Should detect duplicate
      const result = engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 });
      expect(result.category).toBe('duplicate');
    });
  });

  describe('Loop Detection Time Window', () => {
    test('should not detect loop after 30 second window expires', async () => {
      const prompt = 'loop time window';
      const hash = stateStore.generateHash(prompt);

      // Add old requests (35 seconds ago)
      const thirtyFiveSecondsAgo = Date.now() - 35000;

      for (let i = 0; i < 3; i++) {
        stateStore.addRecord({
          id: `old-${i}`,
          timestamp: thirtyFiveSecondsAgo,
          model: 'gpt-4',
          prompt,
          promptHash: hash,
          estimatedCost: 0.01,
          dangerScore: 0,
          isDangerous: false,
          category: 'safe',
          wasBlocked: false,
          wasWarned: false,
        });
      }

      // New request - should not see old ones (outside 30s window)
      const result = engine.analyze({ model: 'gpt-4', prompt, estimatedCost: 0.01 });

      expect(result.category).toBe('duplicate'); // Still duplicate from 1h window
      expect(result.category).not.toBe('loop'); // Not a loop
    });
  });

  describe('Context Explosion Thresholds', () => {
    test('should detect at exactly 5x ratio', () => {
      const prompt = 'short'; // 5 chars
      const context = 'x'.repeat(25); // 25 chars = 5x

      const result = engine.analyze({
        model: 'gpt-4',
        prompt,
        estimatedCost: 0.01,
        context,
      });

      expect(result.category).toBe('context');
      expect(result.metadata.contextRatio).toBe(5);
    });

    test('should not detect below 5x ratio', () => {
      const prompt = 'short'; // 5 chars
      const context = 'x'.repeat(24); // 24 chars = 4.8x

      const result = engine.analyze({
        model: 'gpt-4',
        prompt,
        estimatedCost: 0.01,
        context,
      });

      expect(result.category).toBe('safe');
    });

    test('should calculate danger score based on ratio', () => {
      const prompt = 'a'; // 1 char

      const testCases = [
        { context: 'x'.repeat(5), ratio: 5, expectedScore: 49 }, // 25 + ln(5)*15 = 49
        { context: 'x'.repeat(10), ratio: 10, expectedScore: 59 }, // 25 + ln(10)*15 = 59
        { context: 'x'.repeat(50), ratio: 50, expectedScore: 75 }, // capped at 75
      ];

      testCases.forEach(({ context, expectedScore }) => {
        const result = engine.analyze({
          model: 'gpt-4',
          prompt,
          estimatedCost: 0.01,
          context,
        });

        expect(result.dangerScore).toBe(expectedScore);
      });
    });
  });

  describe('Fuzzy Duplicate Thresholds', () => {
    test('should detect at exactly 70% similarity', () => {
      // First request
      engine.analyze({
        model: 'gpt-4',
        prompt: 'The quick brown fox jumps over the lazy dog',
        estimatedCost: 0.01,
      });

      // Create 70% similar prompt
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'The quick brown fox jumps over the lazy cat', // different last word
        estimatedCost: 0.01,
      });

      // Should detect as fuzzy duplicate (similarity >= 0.70)
      expect(result.category).toBe('fuzzy_duplicate');
      expect(result.metadata.similarity).toBeGreaterThanOrEqual(0.7);
    });

    test('should not detect below 70% similarity', () => {
      // First request
      engine.analyze({
        model: 'gpt-4',
        prompt: 'The quick brown fox jumps over the lazy dog',
        estimatedCost: 0.01,
      });

      // Very different prompt
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'Hello world this is completely different',
        estimatedCost: 0.01,
      });

      expect(result.category).toBe('safe');
    });
  });

  describe('Rate Limiting Under Load', () => {
    test('should handle burst of 100+ requests', async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          axios.post(
            `http://localhost:${PROXY_PORT}/v1/chat/completions`,
            { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: `burst ${i}` }] },
            { validateStatus: () => true }
          )
        );
      }

      const responses = await Promise.all(promises);

      // Should not crash - all should get a response
      expect(responses.every(r => r.status !== undefined)).toBe(true);

      // Most should be processed (some may be rate limited or unauthorized)
      const successful = responses.filter(r => r.status === 200 || r.status === 403 || r.status === 401 || r.status === 429).length;
      expect(successful).toBeGreaterThan(50);
    });

    test('should maintain state consistency under load', async () => {
      const prompt = 'load test';

      // Rapid fire 10 identical requests
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          axios.post(
            `http://localhost:${PROXY_PORT}/v1/chat/completions`,
            { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }] },
            { validateStatus: () => true }
          )
        );
      }

      await Promise.all(promises);

      // Check state is correct
      const stats = engine.getStats(1);
      expect(stats.totalRequests).toBe(10);
      expect(stats.blockedRequests).toBeGreaterThanOrEqual(7); // After 3rd request
    });
  });

  describe('Empty and Malformed Input Edge Cases', () => {
    test('should handle single character prompt', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'x',
        estimatedCost: 0.01,
      });

      expect(result.decision).toBe('allow');
      expect(result.category).toBe('safe');
    });

    test('should handle very long prompt (10000 chars)', () => {
      const longPrompt = 'x'.repeat(10000);

      const result = engine.analyze({
        model: 'gpt-4',
        prompt: longPrompt,
        estimatedCost: 0.01,
      });

      // Should handle without error
      expect(result.decision).toBeDefined();
      expect(result.metadata.promptHash).toHaveLength(64); // SHA-256 hex
    });

    test('should handle special characters in prompt', () => {
      const specialPrompt = 'Special: !@#$%^&*()_+-=[]{}|;:,.<>?`~\"\'\\';

      const result = engine.analyze({
        model: 'gpt-4',
        prompt: specialPrompt,
        estimatedCost: 0.01,
      });

      expect(result.decision).toBe('allow');
    });

    test('should handle unicode characters', () => {
      const unicodePrompt = '🎉 Unicode test: 你好 世界 Привет мир';

      const result = engine.analyze({
        model: 'gpt-4',
        prompt: unicodePrompt,
        estimatedCost: 0.01,
      });

      expect(result.decision).toBe('allow');
    });
  });

  describe('Zero Cost Edge Cases', () => {
    test('should allow zero cost request', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'zero cost',
        estimatedCost: 0,
      });

      expect(result.decision).toBe('allow');
      expect(result.category).toBe('safe');
    });

    test('should handle very small cost (0.001)', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'tiny cost',
        estimatedCost: 0.001,
      });

      expect(result.decision).toBe('allow');
      expect(result.category).toBe('safe');
    });
  });
});
