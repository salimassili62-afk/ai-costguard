/**
 * END-TO-END INTEGRATION TESTS
 * Demonstrates actual firewall detection in realistic production scenarios
 */

import { WasteDetector } from '../waste-detection/wasteDetector';
import { estimateTokens } from '../token-counter/tokenCounter';
import { estimateCost } from '../config/pricing';
import { sharedState } from '../core/SharedState';

describe('End-to-End Integration Tests - Real Detection', () => {
  let detector: WasteDetector;

  beforeEach(() => {
    sharedState.reset();
    detector = sharedState.getWasteDetector();
  });

  afterEach(() => {
    sharedState.reset();
  });

  describe('Production-Ready Scenarios', () => {
    test('Cost $0.05 baseline triggers MEDIUM detection', () => {
      const model = 'gpt-4o-mini';
      const prompt = 'Cost threshold test - unique-001';
      const cost = 0.05;

      const result = detector.detect(model, prompt, cost, undefined, 'warn', false);
      
      expect(result.isDangerous).toBe(true);
      expect(result.category).toBe('spike');
      expect(result.severity).toBe('MEDIUM');
    });

    test('Cost $1.00+ triggers HIGH severity', () => {
      const model = 'gpt-4o-mini';
      const prompt = 'Cost extreme test - unique-002';
      const cost = 1.0;

      const result = detector.detect(model, prompt, cost, undefined, 'warn', false);
      
      expect(result.isDangerous).toBe(true);
      expect(result.category).toBe('spike');
      expect(result.severity).toBe('HIGH');
    });

    test('Context 5x larger triggers HIGH severity', () => {
      const model = 'gpt-4o-mini';
      const prompt = 'Question here';
      const context = 'x'.repeat(70); // ~5x ratio
      const cost = 0.001;

      const result = detector.detect(model, prompt, cost, context, 'warn', false);
      
      expect(result.isDangerous).toBe(true);
      expect(result.category).toBe('context');
      expect(result.severity).toBe('HIGH');
    });

    test('Duplicate detection works', () => {
      const model = 'gpt-4o-mini';
      const prompt = 'Duplicate test - unique-003';
      const cost = 0.001;

      const result1 = detector.detect(model, prompt, cost, undefined, 'warn', false);
      expect(result1.isDangerous).toBe(false);

      const result2 = detector.detect(model, prompt, cost, undefined, 'warn', false);
      expect(result2.isDangerous).toBe(true);
      expect(result2.category).toBe('duplicate');
    });

    test('Loop detection triggers', () => {
      const model = 'gpt-4o-mini';
      const prompt = 'Loop test - unique-004';
      const cost = 0.001;

      let loopDetected = false;
      for (let i = 0; i < 6; i++) {
        const result = detector.detect(model, prompt, cost, undefined, 'block', false);
        if (result.category === 'loop') {
          loopDetected = true;
          break;
        }
      }
      expect(loopDetected).toBe(true);
    });

    test('Block mode enforces blocking', () => {
      const model = 'gpt-4o-mini';
      const prompt = 'Block test - unique-005';
      const cost = 0.001;

      detector.detect(model, prompt, cost, undefined, 'block', false);
      const result = detector.detect(model, prompt, cost, undefined, 'block', false);
      
      expect(result.isDangerous).toBe(true);
      expect(result.action).toBe('block');
    });

    test('Kill switch overrides trust modes', () => {
      const model = 'gpt-4o-mini';
      const prompt = 'Kill switch test - unique-006';
      const cost = 0.001;

      for (let i = 0; i < 5; i++) {
        detector.detect(model, prompt, cost, undefined, 'warn', false);
      }

      const result = detector.detect(model, prompt, cost, undefined, 'warn', false);
      expect(result.killSwitchTriggered).toBe(true);
      expect(result.action).toBe('block');
    });

    test('Override flag bypasses protections', () => {
      const model = 'gpt-4o-mini';
      const prompt = 'Override test - unique-007';
      const cost = 0.001;

      detector.detect(model, prompt, cost, undefined, 'block', false);
      const result = detector.detect(model, prompt, cost, undefined, 'block', true);
      
      expect(result.isDangerous).toBe(true);
      expect(result.action).toBe('allow');
    });
  });

  describe('Token and Cost Integration', () => {
    test('Haiku model is rarely detected as expensive', () => {
      const model = 'claude-3-haiku-20240307';
      const prompt = 'Small question - unique-009';
      
      const tokens = estimateTokens(prompt, model);
      const cost = estimateCost(model, tokens, tokens);

      expect(cost).toBeLessThan(0.001);

      const result = detector.detect(model, prompt, cost, undefined, 'warn', false);
      if (result.isDangerous) {
        expect(result.category).not.toBe('spike');
      }
    });
  });

  describe('State Management', () => {
    test('SharedState provides consistent detector instance', () => {
      const model = 'gpt-4o-mini';
      const prompt = 'State sharing test - unique-010';
      const cost = 0.001;

      const detector1 = sharedState.getWasteDetector();
      detector1.detect(model, prompt, cost);

      const detector2 = sharedState.getWasteDetector();
      expect(detector1).toBe(detector2);

      const result = detector2.detect(model, prompt, cost, undefined, 'warn', false);
      expect(result.isDangerous).toBe(true);
      expect(result.category).toBe('duplicate');
    });
  });
});
