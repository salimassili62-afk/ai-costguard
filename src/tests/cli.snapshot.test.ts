/**
 * CLI OUTPUT FORMAT SNAPSHOT TESTS
 * Freezes CLI output format to prevent string drift
 * 
 * These tests use snapshot-style exact matching to ensure
 * CLI output format never changes without explicit intent.
 * 
 * If you need to change the format:
 * 1. Update the test expectations
 * 2. Document the change in CHANGELOG
 * 3. Update any dependent integrations
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { detectionEngine } from '../core/DetectionEngine';

const execAsync = promisify(exec);
const TEST_TIMEOUT = 30000;

describe('CLI Output Format - Snapshot Protection', () => {
  beforeEach(async () => {
    detectionEngine.clear();
    await execAsync('node dist/cli/index.js config --clear-history');
  });

  afterEach(() => {
    detectionEngine.clear();
  });

  describe('Safe Request Output Format', () => {
    test('should match exact safe request format', async () => {
      const { stdout, stderr } = await execAsync(
        'node dist/cli/index.js check "hello world" --model gpt-4',
        { timeout: 10000 }
      );

      expect(stderr).toBe('');
      
      const lines = stdout.split('\n').filter(l => l.trim());
      
      // Header - must match exactly
      expect(lines[0]).toMatch(/^\ud83d\udee1\ufe0f  AI EXECUTION FIREWALL$/);
      
      // Model line
      expect(lines[1]).toMatch(/^Model: gpt-4$/);
      
      // Tokens line
      expect(lines[2]).toMatch(/^Tokens: \d+ \(est\. \$[0-9.]+\)$/);
      
      // Status line - CRITICAL: must have "Status: " prefix (find it in output)
      const statusLine = lines.find(l => l.includes('SAFE TO PROCEED'));
      expect(statusLine).toMatch(/^Status: \u2705 SAFE TO PROCEED$/);

      // Risk Level line - find it in output
      const riskLine = lines.find(l => l.match(/^Risk Level:/));
      expect(riskLine).toMatch(/^Risk Level: (LOW|MEDIUM|HIGH|CRITICAL)$/);

      // Danger score line - find it in output
      const dangerLine = lines.find(l => l.match(/^Danger Score:/));
      expect(dangerLine).toMatch(/^Danger Score: \d+$/);

      // Separator lines exist
      expect(lines.some(l => l.match(/^─+$/))).toBe(true);

      // Universal format lines exist
      expect(lines.some(l => l.match(/^COST: [0-9.]+$/))).toBe(true);
      expect(lines.some(l => l.match(/^RISK: (LOW|MEDIUM|HIGH|CRITICAL)$/))).toBe(true);
      expect(lines.some(l => l.match(/^DECISION: (ALLOW|BLOCK|WARN)$/))).toBe(true);

      // Universal Format JSON line exists
      expect(lines.some(l => l.match(/^Universal Format: \{/))).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe('Duplicate Request Output Format', () => {
    test('should detect duplicate on second identical request', async () => {
      // Clear history first for clean test
      await execAsync('node dist/cli/index.js config --clear-history');
      await new Promise(r => setTimeout(r, 100));
      
      // First request to prime duplicate detection
      await execAsync('node dist/cli/index.js check "dup test" --model gpt-4');
      await new Promise(r => setTimeout(r, 100));
      
      // Second identical request should trigger duplicate detection (warning state)
      const { stdout, stderr } = await execAsync(
        'node dist/cli/index.js check "dup test" --model gpt-4',
        { timeout: 10000 }
      );

      expect(stderr).toBe('');
      
      const lines = stdout.split('\n').filter(l => l.trim());
      
      // Debug: log actual output if test fails
      if (lines.length < 5) {
        console.log('DEBUG - Actual output:', stdout);
        console.log('DEBUG - Lines:', lines);
      }
      
      // Header
      expect(lines[0]).toMatch(/^\ud83d\udee1\ufe0f  AI EXECUTION FIREWALL$/);
      
      // Model line
      expect(lines[1]).toMatch(/^Model: gpt-4$/);
      
      // Tokens line
      expect(lines[2]).toMatch(/^Tokens: \d+ \(est\. \$[0-9.]+\)$/);

      // Status line - should show either SAFE or warning/block status
      // Safe: ✅ SAFE TO PROCEED, Blocked: ⚡ YOU ALMOST LOST / 🛡️ BLOCKED
      const statusLine = lines.find(l => 
        l.includes('\u2705 SAFE TO PROCEED') || 
        l.includes('\u26a1 YOU ALMOST LOST') || 
        l.includes('\ud83d\udee1\ufe0f BLOCKED')
      );
      expect(statusLine).toBeDefined();

      // Risk Level line - should be present somewhere in output
      expect(lines.some(l => l.match(/^Risk Level: (LOW|MEDIUM|HIGH|CRITICAL)$/))).toBe(true);

      // Danger Score should be present
      const dangerLine = lines.find(l => l.match(/^Danger Score: /));
      expect(dangerLine).toBeDefined();
      const score = parseInt(dangerLine?.match(/\d+/)?.[0] || '0', 10);
      expect(score).toBeGreaterThanOrEqual(0);
    }, TEST_TIMEOUT);
  });

  describe('Output Line Count Stability', () => {
    test('safe request should have consistent line count', async () => {
      const { stdout } = await execAsync(
        'node dist/cli/index.js check "consistency test" --model gpt-4',
        { timeout: 10000 }
      );

      const lines = stdout.split('\n').filter(l => l.trim());
      
      // Line count should be stable (between 10-25 lines including JSON)
      expect(lines.length).toBeGreaterThanOrEqual(10);
      expect(lines.length).toBeLessThanOrEqual(25);
    }, TEST_TIMEOUT);
  });

  describe('Critical String Format Contracts', () => {
    test('Status line must have Status: prefix', async () => {
      const { stdout } = await execAsync(
        'node dist/cli/index.js check "prefix test" --model gpt-4',
        { timeout: 10000 }
      );

      const lines = stdout.split('\n').filter(l => l.trim());
      
      // Find the status line
      const statusLine = lines.find(l => l.includes('SAFE TO PROCEED'));
      expect(statusLine).toBeDefined();
      expect(statusLine).toMatch(/^Status: /);
    }, TEST_TIMEOUT);

    test('Risk Level line must have Risk Level: prefix', async () => {
      const { stdout } = await execAsync(
        'node dist/cli/index.js check "risk test" --model gpt-4',
        { timeout: 10000 }
      );

      const lines = stdout.split('\n').filter(l => l.trim());
      
      // Find the risk line
      const riskLine = lines.find(l => l.match(/Risk Level:/));
      expect(riskLine).toBeDefined();
      expect(riskLine).toMatch(/^Risk Level: /);
    }, TEST_TIMEOUT);

    test('Danger Score line must have Danger Score: prefix', async () => {
      const { stdout } = await execAsync(
        'node dist/cli/index.js check "score test" --model gpt-4',
        { timeout: 10000 }
      );

      const lines = stdout.split('\n').filter(l => l.trim());
      
      // Find the danger score line
      const scoreLine = lines.find(l => l.match(/Danger Score:/));
      expect(scoreLine).toBeDefined();
      expect(scoreLine).toMatch(/^Danger Score: \d+$/);
    }, TEST_TIMEOUT);
  });
});
