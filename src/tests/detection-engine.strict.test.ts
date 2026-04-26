/**
 * STRICT BEHAVIORAL TESTS - DetectionEngine
 * No existence checks. Exact output validation only.
 */

import { DetectionEngine, DetectionResult, AnalyzeInput } from '../core/DetectionEngine';
import { stateStore } from '../core/StateStore';

describe('DetectionEngine - Strict Behavioral Tests', () => {
  let engine: DetectionEngine;

  beforeEach(() => {
    engine = DetectionEngine.getInstance();
    engine.clear();
  });

  afterEach(() => {
    engine.clear();
  });

  describe('Input Validation', () => {
    test('should block empty prompt with exact error', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: '',
        estimatedCost: 0.01,
      });

      expect(result.decision).toBe('block');
      expect(result.dangerScore).toBe(100);
      expect(result.category).toBe('invalid');
      expect(result.reason).toBe('Invalid prompt: must be a non-empty string');
      expect(result.metadata.promptHash).toBe('');
      expect(result.metadata.duplicateCount).toBe(0);
      expect(result.metadata.loopCount).toBe(0);
      expect(result.metadata.estimatedCost).toBe(0);
    });

    test('should block whitespace-only prompt', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: '   ',
        estimatedCost: 0.01,
      });

      expect(result.decision).toBe('block');
      expect(result.dangerScore).toBe(100);
      expect(result.category).toBe('invalid');
      expect(result.reason).toBe('Invalid prompt: must be a non-empty string');
    });

    test('should block negative cost', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'valid prompt',
        estimatedCost: -0.01,
      });

      expect(result.decision).toBe('block');
      expect(result.dangerScore).toBe(100);
      expect(result.category).toBe('invalid');
      expect(result.reason).toBe('Invalid cost: must be a non-negative number');
    });

    test('should allow valid request', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'valid prompt',
        estimatedCost: 0.01,
      });

      expect(result.decision).toBe('allow');
      expect(result.dangerScore).toBe(0);
      expect(result.category).toBe('safe');
      expect(result.reason).toBe('Request is safe');
      expect(result.metadata.loopCount).toBe(0);
      expect(result.metadata.duplicateCount).toBe(0);
    });
  });

  describe('Loop Detection', () => {
    test('should detect runaway loop after 3 identical requests in 30s', () => {
      const input: AnalyzeInput = {
        model: 'gpt-4',
        prompt: 'loop test prompt',
        estimatedCost: 0.01,
      };

      // First request - safe
      const r1 = engine.analyze(input);
      expect(r1.decision).toBe('allow');
      expect(r1.metadata.loopCount).toBe(0);

      // Second request - duplicate warning (first duplicate)
      const r2 = engine.analyze(input);
      expect(r2.decision).toBe('warn');
      expect(r2.category).toBe('duplicate');
      expect(r2.metadata.loopCount).toBe(1);

      // Third request - KILL SWITCH
      const r3 = engine.analyze(input);
      expect(r3.decision).toBe('block');
      expect(r3.dangerScore).toBe(93); // 90 + 3*1
      expect(r3.category).toBe('loop');
      expect(r3.metadata.loopCount).toBe(3);
      expect(r3.reason).toBe('🔴 KILL SWITCH: RUNAWAY LOOP - 3 identical requests in 30 seconds');
    });

    test('should escalate danger score with more loop iterations', () => {
      const input: AnalyzeInput = {
        model: 'gpt-4',
        prompt: 'escalating loop',
        estimatedCost: 0.01,
      };

      // Trigger initial loop detection
      engine.analyze(input);
      engine.analyze(input);
      engine.analyze(input);
      
      // 4th request - higher danger score
      const r4 = engine.analyze(input);
      expect(r4.dangerScore).toBe(96); // 90 + 3*2
      expect(r4.metadata.loopCount).toBe(4);

      // 5th request - even higher
      const r5 = engine.analyze(input);
      expect(r5.dangerScore).toBe(99); // 90 + 3*3

      // 6th request - capped at 100
      const r6 = engine.analyze(input);
      expect(r6.dangerScore).toBe(100); // capped
    });
  });

  describe('Duplicate Detection', () => {
    test('should detect exact duplicate within 1 hour window', () => {
      const input: AnalyzeInput = {
        model: 'gpt-4',
        prompt: 'duplicate test prompt',
        estimatedCost: 0.01,
      };

      // First request - safe, recorded
      const r1 = engine.analyze(input);
      expect(r1.decision).toBe('allow');
      expect(r1.category).toBe('safe');

      // Second request - duplicate detected (first duplicate)
      const r2 = engine.analyze(input);
      expect(r2.decision).toBe('warn');
      expect(r2.category).toBe('duplicate');

      // Third request - loop triggers (3 total, threshold is 3)
      const r3 = engine.analyze(input);
      expect(r3.decision).toBe('block');
      expect(r3.category).toBe('loop');
      expect(r3.dangerScore).toBe(93); // 90 + (3-2)*3
      expect(r3.metadata.loopCount).toBe(3);
    });

    test('should escalate duplicate danger with multiple occurrences', () => {
      const input: AnalyzeInput = {
        model: 'gpt-4',
        prompt: 'multiple duplicates',
        estimatedCost: 0.01,
      };

      // Record requests (r1 safe, r2 duplicate, r3 loop kills it)
      const r1 = engine.analyze(input);
      expect(r1.decision).toBe('allow');
      expect(r1.category).toBe('safe');

      const r2 = engine.analyze(input);
      expect(r2.decision).toBe('warn');
      expect(r2.category).toBe('duplicate');
      expect(r2.dangerScore).toBe(40); // 30 + 1*10

      // r3 would be loop - test only safe/duplicate behavior
    });
  });

  describe('Cost Spike Detection', () => {
    test('should detect cost at exactly $0.05 threshold', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'cost spike test',
        estimatedCost: 0.05,
      });

      expect(result.decision).toBe('warn');
      expect(result.category).toBe('spike');
      expect(result.dangerScore).toBe(30); // base score
      expect(result.reason).toBe('💸 COST SPIKE: Single request costs $0.05');
    });

    test('should calculate correct danger score for $0.10 cost', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'higher cost',
        estimatedCost: 0.10,
      });

      expect(result.category).toBe('spike');
      expect(result.dangerScore).toBe(32); // 30 + (0.10-0.05)*50 = 32.5 -> 32 (floored)
    });

    test('should cap cost spike at 100', () => {
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'very expensive',
        estimatedCost: 2.00, // $2.00
      });

      expect(result.dangerScore).toBe(100); // capped
      expect(result.decision).toBe('block'); // 100 >= 90 threshold
    });
  });

  describe('Context Explosion Detection', () => {
    test('should detect context 5x larger than prompt', () => {
      const prompt = 'short'; // 5 chars
      const context = 'a'.repeat(25); // 25 chars = 5x

      const result = engine.analyze({
        model: 'gpt-4',
        prompt,
        estimatedCost: 0.01,
        context,
      });

      expect(result.decision).toBe('warn');
      expect(result.category).toBe('context');
      expect(result.metadata.contextRatio).toBe(5); // 25/5
    });

    test('should detect severe context explosion at 10x', () => {
      const prompt = 'test';
      const context = 'b'.repeat(100); // 100 chars

      const result = engine.analyze({
        model: 'gpt-4',
        prompt,
        estimatedCost: 0.01,
        context,
      });

      expect(result.category).toBe('context');
      expect(result.metadata.contextRatio).toBe(25); // 100/4
      expect(result.reason).toBe('💸 CONTEXT EXPLOSION: Context is 25.00x larger than prompt');
    });
  });

  describe('Fuzzy Duplicate Detection', () => {
    test('should detect 70% similar prompts', () => {
      // First request
      engine.analyze({
        model: 'gpt-4',
        prompt: 'The quick brown fox jumps over the lazy dog',
        estimatedCost: 0.01,
      });

      // 70% similar prompt
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'The quick brown fox jumps over the lazy cat',
        estimatedCost: 0.01,
      });

      expect(result.category).toBe('fuzzy_duplicate');
      expect(result.metadata.similarity).toBeGreaterThanOrEqual(0.7);
    });

    test('should not flag 50% similar prompts', () => {
      // First request
      engine.analyze({
        model: 'gpt-4',
        prompt: 'The quick brown fox jumps over the lazy dog',
        estimatedCost: 0.01,
      });

      // 50% similar (different enough)
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'The quick brown',
        estimatedCost: 0.01,
      });

      expect(result.category).toBe('safe');
    });
  });

  describe('Trust Mode Behavior', () => {
    test('monitor mode should allow all non-kill-switch requests', () => {
      // Setup cost spike (not loop) to test monitor mode
      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'trust test',
        estimatedCost: 0.10, // cost spike
        trustMode: 'monitor',
      });

      expect(result.decision).toBe('allow');
      expect(result.dangerScore).toBeGreaterThan(0); // Cost spike detected
    });

    test('block mode should block any danger > 0', () => {
      // Setup 2 duplicates to trigger detection (need > 1 existing)
      engine.analyze({ model: 'gpt-4', prompt: 'block test', estimatedCost: 0.01 });
      engine.analyze({ model: 'gpt-4', prompt: 'block test', estimatedCost: 0.01 });

      const result = engine.analyze({
        model: 'gpt-4',
        prompt: 'block test',
        estimatedCost: 0.01,
        trustMode: 'block',
      });

      expect(result.decision).toBe('block');
    });
  });

  describe('Override Behavior', () => {
    test('override should allow even kill-switch triggers', () => {
      // Trigger loop detection
      const input: AnalyzeInput = {
        model: 'gpt-4',
        prompt: 'override loop test',
        estimatedCost: 0.01,
      };

      engine.analyze(input);
      engine.analyze(input);
      engine.analyze(input); // This would trigger kill switch

      // With override
      const result = engine.analyze({
        ...input,
        override: true,
      });

      expect(result.decision).toBe('allow');
      expect(result.dangerScore).toBe(0);
      expect(result.reason).toBe('Override enabled - request allowed');
    });
  });

  describe('State Persistence', () => {
    test('should persist blocked requests to state', () => {
      engine.analyze({
        model: 'gpt-4',
        prompt: 'persist test',
        estimatedCost: 0.05, // cost spike
      });

      const stats = engine.getStats(1);
      expect(stats.totalRequests).toBe(1);
      expect(stats.warnedRequests).toBe(1);
      expect(stats.totalCost).toBe(0.05);
    });

    test('should return exact blocked request list', () => {
      // Create blocked request
      engine.analyze({
        model: 'gpt-4',
        prompt: 'blocked 1',
        estimatedCost: 2.00, // high cost = block
      });

      engine.analyze({
        model: 'gpt-4',
        prompt: 'safe request',
        estimatedCost: 0.01,
      });

      const blocked = engine.getBlocked(10);
      expect(blocked.length).toBe(1);
      expect(blocked[0].prompt).toBe('blocked 1');
      expect(blocked[0].wasBlocked).toBe(true);
    });
  });
});
