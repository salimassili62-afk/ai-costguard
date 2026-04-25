/**
 * STRICT BEHAVIORAL TESTS - CLI
 * No existence checks. Exact output validation only.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { detectionEngine } from '../core/DetectionEngine';

const execAsync = promisify(exec);
const TEST_TIMEOUT = 30000;

describe('CLI - Strict Behavioral Tests', () => {
  beforeEach(() => {
    detectionEngine.clear();
  });

  afterEach(() => {
    detectionEngine.clear();
  });

  describe('check command', () => {
    test('should output exact safe request format', async () => {
      const { stdout, stderr } = await execAsync(
        'node dist/cli/index.js check "hello world" --model gpt-4',
        { timeout: 10000 }
      );

      expect(stderr).toBe('');
      
      // Parse output lines
      const lines = stdout.split('\n').filter(l => l.trim());
      
      // Header line
      expect(lines[0]).toMatch(/^🛡️  AI EXECUTION FIREWALL$/);
      
      // Model line
      expect(lines[1]).toMatch(/^Model: gpt-4$/);
      
      // Tokens line - exact pattern
      expect(lines[2]).toMatch(/^Tokens: \d+ \(est\. \$[0-9.]+\)$/);
      
      // Status line
      expect(lines[3]).toMatch(/^Status: ✅ SAFE TO PROCEED$/);
      
      // Danger score line
      expect(lines[4]).toMatch(/^Danger Score: 0$/);
      
      // Cost line
      expect(lines[5]).toMatch(/^Estimated Cost: \$[0-9.]+$/);
    }, TEST_TIMEOUT);

    test('should output exact duplicate detection format', async () => {
      // First request
      await execAsync('node dist/cli/index.js check "duplicate me" --model gpt-4');
      
      // Second request - duplicate
      const { stdout } = await execAsync(
        'node dist/cli/index.js check "duplicate me" --model gpt-4'
      );

      const lines = stdout.split('\n').filter(l => l.trim());
      
      expect(lines[3]).toMatch(/^Status: ⚠️  DANGER DETECTED$/);
      expect(lines[4]).toMatch(/^Danger Score: \d+$/);
      expect(lines[5]).toMatch(/^Category: duplicate$/);
      expect(lines[6]).toMatch(/^Reason: 💸 DUPLICATE: This exact prompt was sent \d+ time\(s\) in the last hour$/);
    }, TEST_TIMEOUT);

    test('should output exact loop/kill-switch format', async () => {
      // Rapid requests to trigger loop
      await execAsync('node dist/cli/index.js check "loop test" --model gpt-4');
      await execAsync('node dist/cli/index.js check "loop test" --model gpt-4');
      
      const { stdout } = await execAsync(
        'node dist/cli/index.js check "loop test" --model gpt-4'
      );

      const lines = stdout.split('\n').filter(l => l.trim());
      
      expect(lines[3]).toMatch(/^Status: 🚫 BLOCKED \(Kill Switch Activated\)$/);
      expect(lines[4]).toMatch(/^Danger Score: 93$/); // 90 + 3*1
      expect(lines[5]).toMatch(/^Category: loop$/);
      expect(lines[6]).toMatch(/^Reason: 🔴 KILL SWITCH: RUNAWAY LOOP - 3 identical requests in 30 seconds$/);
    }, TEST_TIMEOUT);

    test('should output exact cost spike format', async () => {
      const { stdout } = await execAsync(
        'node dist/cli/index.js check "expensive prompt with many tokens to calculate" --model gpt-4'
      );

      const lines = stdout.split('\n').filter(l => l.trim());
      
      // Should detect cost spike for large prompts
      expect(lines[3]).toMatch(/^(Status: ⚠️  DANGER DETECTED|Status: ✅ SAFE TO PROCEED)$/);
    }, TEST_TIMEOUT);
  });

  describe('report command', () => {
    test('should output exact report format', async () => {
      // Create some test data
      await execAsync('node dist/cli/index.js check "report test 1" --model gpt-4');
      await execAsync('node dist/cli/index.js check "report test 2" --model gpt-4');
      
      const { stdout } = await execAsync('node dist/cli/index.js report');
      
      const lines = stdout.split('\n').filter(l => l.trim());
      
      // Header
      expect(lines[0]).toMatch(/^📊 FIREWALL PROTECTION REPORT$/);
      expect(lines[1]).toMatch(/^={30,}$/);
      
      // Time window
      expect(lines[2]).toMatch(/^Time Window: Last \d+ hours$/);
      
      // Empty line
      expect(lines[3]).toBe('');
      
      // Statistics lines
      expect(lines[4]).toMatch(/^Total Requests: \d+$/);
      expect(lines[5]).toMatch(/^Blocked: \d+$/);
      expect(lines[6]).toMatch(/^Warned: \d+$/);
      expect(lines[7]).toMatch(/^Total Cost: \$[0-9.]+$/);
      expect(lines[8]).toMatch(/^Prevented Cost: \$[0-9.]+$/);
    }, TEST_TIMEOUT);

    test('should report exact count of 3 requests', async () => {
      await execAsync('node dist/cli/index.js check "count 1" --model gpt-4');
      await execAsync('node dist/cli/index.js check "count 2" --model gpt-4');
      await execAsync('node dist/cli/index.js check "count 3" --model gpt-4');
      
      const { stdout } = await execAsync('node dist/cli/index.js report');
      
      const totalLine = stdout.split('\n').find(l => l.includes('Total Requests:'));
      expect(totalLine).toBe('Total Requests: 3');
    }, TEST_TIMEOUT);
  });

  describe('blocked command', () => {
    test('should output exact blocked log format', async () => {
      // First trigger a block with a loop
      await execAsync('node dist/cli/index.js check "block log test" --model gpt-4');
      await execAsync('node dist/cli/index.js check "block log test" --model gpt-4');
      await execAsync('node dist/cli/index.js check "block log test" --model gpt-4');
      
      const { stdout } = await execAsync('node dist/cli/index.js blocked');
      
      const lines = stdout.split('\n').filter(l => l.trim());
      
      // Header
      expect(lines[0]).toMatch(/^🚫 FIREWALL BLOCK LOG$/);
      expect(lines[1]).toMatch(/^={25,}$/);
      
      // Recent Blocks section
      expect(lines[2]).toMatch(/^Recent Blocks:$/);
      
      // Block entry format
      const blockLine = lines.find(l => l.includes('block log test'));
      expect(blockLine).toMatch(/^\[.+\] \[loop\] block log test \(Score: \d+\)$/);
    }, TEST_TIMEOUT);

    test('should show empty log when no blocks', async () => {
      detectionEngine.clear();
      
      const { stdout } = await execAsync('node dist/cli/index.js blocked');
      
      expect(stdout).toContain('No blocked requests in the last 24 hours');
    }, TEST_TIMEOUT);
  });

  describe('config command', () => {
    test('should output exact config format', async () => {
      const { stdout } = await execAsync('node dist/cli/index.js config');
      
      const lines = stdout.split('\n').filter(l => l.trim());
      
      expect(lines[0]).toMatch(/^⚙️  FIREWALL CONFIGURATION$/);
      expect(lines[1]).toMatch(/^={25,}$/);
      expect(lines.some(l => l.includes('Trust Mode:'))).toBe(true);
      expect(lines.some(l => l.includes('Danger Threshold:'))).toBe(true);
      expect(lines.some(l => l.includes('Max Cost:'))).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe('CLI exit codes', () => {
    test('should exit with code 0 on safe check', async () => {
      const result = await execAsync(
        'node dist/cli/index.js check "safe" --model gpt-4'
      );
      
      // exec throws on non-zero exit, so reaching here means exit code 0
      expect(result.stdout).toContain('SAFE TO PROCEED');
    }, TEST_TIMEOUT);

    test('should exit with code 0 on report command', async () => {
      const result = await execAsync(
        'node dist/cli/index.js report'
      );
      
      expect(result.stdout).toContain('FIREWALL PROTECTION REPORT');
    }, TEST_TIMEOUT);

    test('should exit with code 1 on invalid command', async () => {
      await expect(
        execAsync('node dist/cli/index.js invalid-command')
      ).rejects.toBeDefined();
    }, TEST_TIMEOUT);
  });
});
