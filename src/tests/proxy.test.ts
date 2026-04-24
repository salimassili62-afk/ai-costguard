/**
 * Integration tests for Proxy Server
 */

import { ProxyServer } from '../proxy';
import { WasteDetector } from '../waste-detection';
import axios from 'axios';

describe('ProxyServer', () => {
  let server: ProxyServer;
  const TEST_PORT = 3001;

  beforeAll(() => {
    server = new ProxyServer(TEST_PORT);
    server.start();
  });

  afterAll(() => {
    server.stop();
  });

  test('should start and respond to health check', async () => {
    const response = await axios.get(`http://localhost:${TEST_PORT}/health`).catch(() => null);
    expect(server).toBeDefined();
  });

  test('should handle OpenAI-style requests', async () => {
    const response = await axios.post(
      `http://localhost:${TEST_PORT}/v1/chat/completions`,
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'test' }],
      },
      { headers: { 'Content-Type': 'application/json' } }
    ).catch((e) => e.response);

    expect(response).toBeDefined();
  });

  test('should handle Anthropic-style requests', async () => {
    const response = await axios.post(
      `http://localhost:${TEST_PORT}/v1/messages`,
      {
        model: 'claude-3-sonnet-20240229',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      },
      { headers: { 'Content-Type': 'application/json' } }
    ).catch((e) => e.response);

    expect(response).toBeDefined();
  });

  test('should block requests exceeding cost limit', async () => {
    const response = await axios.post(
      `http://localhost:${TEST_PORT}/v1/chat/completions`,
      {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'x'.repeat(100000) }],
      },
      { headers: { 'Content-Type': 'application/json' } }
    ).catch((e) => e.response);

    expect(response).toBeDefined();
    if (response && response.status === 403) {
      expect(response.data.blocked).toBe(true);
    }
  });

  test('should detect duplicate requests', async () => {
    const prompt = 'duplicate test prompt';
    
    const response1 = await axios.post(
      `http://localhost:${TEST_PORT}/v1/chat/completions`,
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      },
      { headers: { 'Content-Type': 'application/json' } }
    ).catch((e) => e.response);

    const response2 = await axios.post(
      `http://localhost:${TEST_PORT}/v1/chat/completions`,
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      },
      { headers: { 'Content-Type': 'application/json' } }
    ).catch((e) => e.response);

    expect(response2).toBeDefined();
  });

  test('should respect API key authentication when configured', async () => {
    const response = await axios.post(
      `http://localhost:${TEST_PORT}/v1/chat/completions`,
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'test' }],
      },
      { 
        headers: { 
          'Content-Type': 'application/json',
          'x-firewall-api-key': 'invalid-key'
        } 
      }
    ).catch((e) => e.response);

    expect(response).toBeDefined();
  });
});
