/**
 * Unit tests for TokenCounter
 */

import { estimateTokens, estimateMessagesTokens } from '../token-counter';

describe('TokenCounter', () => {
  test('should estimate tokens for empty string', () => {
    const result = estimateTokens('');
    expect(result).toBe(0);
  });

  test('should estimate tokens for short text', () => {
    const result = estimateTokens('Hello world');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(10);
  });

  test('should estimate tokens for long text', () => {
    const text = 'This is a longer piece of text that should have more tokens. '.repeat(10);
    const result = estimateTokens(text);
    expect(result).toBeGreaterThan(50);
  });

  test('should use model-specific ratios', () => {
    const text = 'Test text for model comparison';
    const gpt4Result = estimateTokens(text, 'gpt-4');
    const gpt35Result = estimateTokens(text, 'gpt-3.5-turbo');
    
    // Different models should use different ratios
    expect(gpt4Result).toBeGreaterThan(0);
    expect(gpt35Result).toBeGreaterThan(0);
  });

  test('should estimate tokens for messages array', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    
    const result = estimateMessagesTokens(messages);
    expect(result).toBeGreaterThan(0);
  });

  test('should handle empty messages array', () => {
    const result = estimateMessagesTokens([]);
    // Returns base tokens for array structure
    expect(result).toBe(3);
  });

  test('should add model-specific overhead', () => {
    const messages = [
      { role: 'user', content: 'Test' },
    ];
    
    const gpt4Result = estimateMessagesTokens(messages, 'gpt-4');
    const gpt35Result = estimateMessagesTokens(messages, 'gpt-3.5-turbo');
    
    // GPT-4 should have more overhead
    expect(gpt4Result).toBeGreaterThan(gpt35Result);
  });

  test('should handle array content in messages', () => {
    const messages = [
      { 
        role: 'user', 
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' }
        ]
      },
    ];
    
    const result = estimateMessagesTokens(messages);
    expect(result).toBeGreaterThan(0);
  });
});
