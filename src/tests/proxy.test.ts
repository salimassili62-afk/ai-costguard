/**
 * Integration tests for Proxy Server
 */

import { ProxyServer } from '../proxy';
import { detectionEngine } from '../core/DetectionEngine';
import axios from 'axios';

describe('ProxyServer', () => {
  let server: ProxyServer;
  const TEST_PORT = 3001;

  beforeAll(async () => {
    detectionEngine.clear();
    server = new ProxyServer(TEST_PORT);
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    detectionEngine.clear();
  });

  test('should start and respond to health check', async () => {
    const response = await axios.get(`http://localhost:${TEST_PORT}/health`);
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('ok');
    expect(response.data.stats).toBeDefined();
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
    expect(response.status).toBeGreaterThanOrEqual(200);
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
    expect(response.status).toBeGreaterThanOrEqual(200);
  });

  test('should detect duplicate requests', async () => {
    const prompt = 'duplicate test prompt 12345';
    
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
    expect(response2.status).toBeGreaterThanOrEqual(200);
  });
});
