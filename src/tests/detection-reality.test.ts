/**
 * REALITY TESTS - These tests verify actual detection behavior
 * They should FAIL if detection is not working correctly
 */

import { WasteDetector } from '../waste-detection/wasteDetector';
import { sharedState } from '../core/SharedState';

describe('Detection Reality Tests', () => {
  let detector: WasteDetector;

  beforeEach(() => {
    sharedState.reset();
    detector = sharedState.getWasteDetector();
  });

  afterEach(() => {
    sharedState.reset();
  });

  test('10 identical requests MUST trigger duplicate/loop detection', () => {
    const model = 'gpt-4';
    const prompt = 'test prompt for duplicate detection';
    const cost = 0.01;

    let dangerousCount = 0;
    let loopTriggered = false;
    let duplicateTriggered = false;

    for (let i = 0; i < 10; i++) {
      const result = detector.detect(model, prompt, cost);
      if (result.isDangerous) {
        dangerousCount++;
        if (result.category === 'loop') loopTriggered = true;
        if (result.category === 'duplicate') duplicateTriggered = true;
      }
    }

    // At least one request should be detected as dangerous
    expect(dangerousCount).toBeGreaterThan(0);
    // Either loop or duplicate should trigger
    expect(loopTriggered || duplicateTriggered).toBe(true);
  });

  test('Large prompt MUST trigger context/cost warning', () => {
    const model = 'gpt-4';
    const largePrompt = 'x'.repeat(100000); // 100k characters
    const cost = 1.0; // $1.00

    const result = detector.detect(model, largePrompt, cost);

    // Large cost should trigger spike detection
    expect(result.isDangerous).toBe(true);
    expect(result.category).toBe('spike');
    expect(result.dangerScore).toBeGreaterThan(50);
  });

  test('Similar prompts MUST trigger fuzzy detection', () => {
    const model = 'gpt-4';
    const prompt1 = 'What is the capital of France?';
    const prompt2 = 'What is the capital of France?'; // Identical first
    const prompt3 = 'What is the capital city of France?'; // Slightly different
    const cost = 0.01;

    // First request should be safe
    const result1 = detector.detect(model, prompt1, cost);
    expect(result1.isDangerous).toBe(false);

    // Second identical request should trigger duplicate
    const result2 = detector.detect(model, prompt2, cost);
    expect(result2.isDangerous).toBe(true);
    expect(result2.category).toBe('duplicate');

    // Third similar request should trigger fuzzy
    const result3 = detector.detect(model, prompt3, cost);
    expect(result3.isDangerous).toBe(true);
    expect(result3.category).toBe('fuzzy_duplicate');
  });

  test('Context explosion MUST trigger warning', () => {
    const model = 'gpt-4';
    const prompt = 'short prompt';
    const context = 'x'.repeat(10000); // 10k characters context
    const cost = 0.1;

    const result = detector.detect(model, prompt, cost, context);

    // Context much larger than prompt should trigger
    expect(result.isDangerous).toBe(true);
    expect(result.category).toBe('context');
  });

  test('Rapid repeated requests MUST trigger loop detection', () => {
    const model = 'gpt-4';
    const prompt = 'rapid test';
    const cost = 0.01;

    let loopTriggered = false;

    // Send 5 requests rapidly (within 30 seconds)
    for (let i = 0; i < 5; i++) {
      const result = detector.detect(model, prompt, cost);
      if (result.category === 'loop') {
        loopTriggered = true;
      }
    }

    // Loop should trigger after 3+ rapid requests
    expect(loopTriggered).toBe(true);
  });
});
