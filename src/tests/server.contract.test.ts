/**
 * Server Contract Tests
 * Verifies that ProxyServer correctly implements its contract
 */

import { ProxyServer } from '../proxy';
import { detectionEngine } from '../core/DetectionEngine';

describe('ProxyServer Contract', () => {
  let server: ProxyServer;
  const TEST_PORT = 3999;

  afterEach(async () => {
    if (server && server.isListening()) {
      await server.stop();
    }
    detectionEngine.clear();
  });

  test('should expose isListening() method', () => {
    server = new ProxyServer(TEST_PORT);
    expect(typeof server.isListening).toBe('function');
  });

  test('isListening() should return false before start', () => {
    server = new ProxyServer(TEST_PORT);
    expect(server.isListening()).toBe(false);
  });

  test('isListening() should return true after start', async () => {
    server = new ProxyServer(TEST_PORT);
    await server.start();
    expect(server.isListening()).toBe(true);
  });

  test('isListening() should return false after stop', async () => {
    server = new ProxyServer(TEST_PORT);
    await server.start();
    expect(server.isListening()).toBe(true);

    await server.stop();
    expect(server.isListening()).toBe(false);
  });

  test('should expose maxRetries property', () => {
    server = new ProxyServer(TEST_PORT);
    expect(typeof server.maxRetries).toBe('number');
    expect(server.maxRetries).toBeGreaterThan(0);
  });

  test('should expose clearRateLimits() method', () => {
    server = new ProxyServer(TEST_PORT);
    expect(typeof server.clearRateLimits).toBe('function');
  });
});
