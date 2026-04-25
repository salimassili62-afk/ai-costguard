/**
 * Integration tests for CLI commands with persistent storage
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { detectionEngine } from '../core/DetectionEngine';

const execAsync = promisify(exec);
const TEST_TIMEOUT = 15000; // 15 seconds for file I/O operations

describe('CLI Commands', () => {
  // Clear history before tests to ensure clean state
  beforeAll(() => {
    detectionEngine.clear();
  });

  afterAll(() => {
    detectionEngine.clear();
  });

  test('check command should validate safety and show output', async () => {
    const { stdout } = await execAsync('node dist/cli/index.js check "test prompt" --model gpt-4');
    expect(stdout).toContain('AI EXECUTION FIREWALL');
    expect(stdout).toContain('Model:');
    expect(stdout).toContain('Tokens:');
    expect(stdout).toContain('Estimated Cost:');
  }, TEST_TIMEOUT);

  test('check command should detect duplicates across multiple calls', async () => {
    // Clear history first
    detectionEngine.clear();
    
    // First call should be safe
    const result1 = await execAsync('node dist/cli/index.js check "duplicate test prompt" --model gpt-4');
    expect(result1.stdout).toContain('SAFE TO PROCEED');
    
    // Second call should detect duplicate
    const result2 = await execAsync('node dist/cli/index.js check "duplicate test prompt" --model gpt-4');
    expect(result2.stdout).toContain('DUPLICATE');
    expect(result2.stdout).toContain('DANGER DETECTED');
  }, TEST_TIMEOUT);

  test('report command should show accumulated statistics', async () => {
    // Clear and add some requests
    detectionEngine.clear();
    
    // Add a few requests
    await execAsync('node dist/cli/index.js check "test1" --model gpt-4');
    await execAsync('node dist/cli/index.js check "test2" --model gpt-4');
    await execAsync('node dist/cli/index.js check "test3" --model gpt-4');
    
    // Check report shows accumulated requests
    const { stdout } = await execAsync('node dist/cli/index.js report');
    expect(stdout).toContain('FIREWALL PROTECTION REPORT');
    expect(stdout).toContain('Total Requests:');
    expect(stdout).toContain('3');
  }, TEST_TIMEOUT);

  test('blocked command should show block log', async () => {
    const { stdout } = await execAsync('node dist/cli/index.js blocked');
    expect(stdout).toContain('FIREWALL BLOCK LOG');
  }, TEST_TIMEOUT);
});
