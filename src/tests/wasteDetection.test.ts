/**
 * Unit tests for WasteDetector
 */

import { WasteDetector } from '../waste-detection/wasteDetector';
import { sharedState } from '../core/SharedState';

describe('WasteDetector', () => {
  let detector: WasteDetector;

  beforeEach(() => {
    sharedState.reset();
    detector = sharedState.getWasteDetector();
  });

  afterEach(() => {
    sharedState.reset();
  });

  test('should detect duplicate requests', () => {
    const model = 'gpt-4';
    const prompt = 'Test prompt';
    const cost = 0.01;

    // First request should not be dangerous
    const result1 = detector.detect(model, prompt, cost);
    expect(result1.isDangerous).toBe(false);

    // Second identical request should be detected as dangerous
    const result2 = detector.detect(model, prompt, cost);
    expect(result2.isDangerous).toBe(true);
    expect(result2.dangerScore).toBeGreaterThan(0);
    expect(result2.reason).toContain('DUPLICATE');
  });

  test('should detect rapid repeated calls', () => {
    const model = 'gpt-4';
    const prompt = 'Test prompt';
    const cost = 0.01;

    // Send 5 identical requests rapidly
    for (let i = 0; i < 5; i++) {
      detector.detect(model, prompt, cost);
    }

    // 6th request should trigger rapid call detection
    const result = detector.detect(model, prompt, cost);
    expect(result.isDangerous).toBe(true);
    expect(result.reason).toContain('RUNAWAY LOOP');
    expect(result.killSwitchTriggered).toBe(true);
  });

  test('should detect large context', () => {
    const model = 'gpt-4';
    const prompt = 'Short prompt';
    const cost = 0.01;
    const largeContext = 'x'.repeat(10000); // 10KB context

    const result = detector.detect(model, prompt, cost, largeContext);
    expect(result.isDangerous).toBe(true);
    expect(result.reason).toContain('CONTEXT');
  });

  test('should allow efficient requests', () => {
    const model = 'gpt-4';
    const prompt = 'Unique efficient prompt';
    const cost = 0.01;

    const result = detector.detect(model, prompt, cost);
    expect(result.isDangerous).toBe(false);
    expect(result.dangerScore).toBe(0);
  });

  test('should respect trust mode', () => {
    const model = 'gpt-4';
    const prompt = 'Test prompt';
    const cost = 0.01;

    // First request
    detector.detect(model, prompt, cost);
    
    // Second request with monitor mode should allow
    const resultMonitor = detector.detect(model, prompt, cost, undefined, 'monitor');
    expect(resultMonitor.isDangerous).toBe(true);
    expect(resultMonitor.action).toBe('allow');

    // With block mode should block
    const resultBlock = detector.detect(model, prompt, cost, undefined, 'block');
    expect(resultBlock.isDangerous).toBe(true);
    expect(resultBlock.action).toBe('block');
  });

  test('should respect override flag', () => {
    const model = 'gpt-4';
    const prompt = 'Test prompt';
    const cost = 0.01;

    // First request
    detector.detect(model, prompt, cost);
    
    // Second request with override should allow even in block mode
    const result = detector.detect(model, prompt, cost, undefined, 'block', true);
    expect(result.isDangerous).toBe(true);
    expect(result.action).toBe('allow');
  });

  test('kill switch should override trust mode', () => {
    const model = 'gpt-4';
    const prompt = 'Test prompt';
    const cost = 0.01;

    // Send 5 identical requests rapidly to trigger kill switch
    for (let i = 0; i < 5; i++) {
      detector.detect(model, prompt, cost);
    }

    // 6th request should trigger kill switch even in warn mode
    const result = detector.detect(model, prompt, cost, undefined, 'warn');
    expect(result.isDangerous).toBe(true);
    expect(result.killSwitchTriggered).toBe(true);
    expect(result.action).toBe('block'); // Should block despite warn mode
  });

  test('should include killSwitchTriggered in safe results', () => {
    const model = 'gpt-4';
    const prompt = 'Unique prompt';
    const cost = 0.01;

    const result = detector.detect(model, prompt, cost);
    expect(result.isDangerous).toBe(false);
    expect(result.killSwitchTriggered).toBe(false);
  });
});
